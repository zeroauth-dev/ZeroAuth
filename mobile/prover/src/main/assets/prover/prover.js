/*
 * prover.js — WebView-side Groth16 prover for the W3 phone app.
 *
 * Lives in /android/app/src/main/assets/prover/ and is loaded by
 * prover.html under the locked CSP defined in ADR-0010 (no network,
 * no inline, wasm-unsafe-eval is the only escape hatch — snarkjs needs
 * it to compile the circuit WASM).
 *
 * Inbound contract (Kotlin → WebView via window.zaHandleProve(jsonString)):
 *
 *     {
 *       "type": "prove",
 *       "inputs": {
 *         "biometricSecret":  "<decimal field>",
 *         "salt":             "<decimal field>",
 *         "commitment":       "<decimal field>",   // optional fast-fail check
 *         "didHashRaw":       "<decimal field>",
 *         "sessionNonce":     "<decimal field>"
 *       }
 *     }
 *
 * Outbound contract (WebView → Kotlin via ZABridge.onMessage(string)):
 *
 *     {type: "ready"}                                      (once on load)
 *     {type: "progress", percent: N}                       (during proving)
 *     {type: "result", proof, publicSignals, verifyOk,
 *      didHashSession, identityBinding, commitment, proofMs}
 *     {type: "error", code, message}                       (terminal failure)
 *
 * The prover does the Option B' fold internally so the host never has
 * to compute Poseidon outside the sandbox:
 *
 *   didHashSession  = Poseidon(2)([didHashRaw, sessionNonce])
 *   identityBinding = Poseidon(2)([biometricSecret, didHashSession])
 *
 * It then runs snarkjs.groth16.fullProve and self-verifies against the
 * bundled verification_key.json before handing the proof back to Kotlin.
 * Self-verify is defense in depth: if the WebView's runtime is
 * compromised in a way that returns a malformed proof, the verify
 * step catches it on-device before it ever leaves the sandbox.
 */

(function () {
  'use strict';

  // ZABridge is the JavaScriptInterface installed by Kotlin (see
  // WebViewMobileProver.kt). All return traffic goes through its
  // onMessage(string) method. We swallow exceptions on send because
  // the WebView outlives the Kotlin continuation in tear-down.
  function send(obj) {
    var msg;
    try {
      msg = JSON.stringify(obj);
    } catch (e) {
      msg = JSON.stringify({
        type: 'error',
        code: 'serialize_failed',
        message: String(e && e.message)
      });
    }
    try {
      if (window.ZABridge && typeof window.ZABridge.onMessage === 'function') {
        window.ZABridge.onMessage(msg);
      }
    } catch (_) {
      // Renderer-side bridge errors are unrecoverable; just drop.
    }
  }

  function error(code, message) {
    send({ type: 'error', code: code, message: String(message || code) });
  }

  function setStatus(text) {
    var el = document.getElementById('status');
    if (el) el.textContent = text;
  }

  // BN128 scalar field modulus. Inputs MUST be < this. The W2 circuit
  // assumes inputs are reduced modulo this field; passing larger values
  // produces witnesses that snarkjs accepts but the on-chain verifier
  // would reject. Better to fail fast here.
  var FIELD_MODULUS = BigInt(
    '21888242871839275222246405745257275088548364400416034343698204186575808495617'
  );
  function requireField(name, raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(name + ' must be a non-empty decimal string');
    }
    if (!/^[0-9]+$/.test(raw)) {
      throw new Error(name + ' must be a decimal string of digits');
    }
    var n = BigInt(raw);
    if (n < 0n || n >= FIELD_MODULUS) {
      throw new Error(name + ' is outside the BN128 scalar field');
    }
    return n;
  }

  // Cached after first prove so the second proof in a session doesn't
  // re-fetch the vkey.
  var cachedVkey = null;

  // Asset paths are relative to prover.html, which is served from
  // https://appassets.androidplatform.net/assets/prover/prover.html.
  // The WebViewAssetLoader resolves relative URLs against that path.
  var WASM_URL = 'identity_proof.wasm';
  var ZKEY_URL = 'circuit_final.zkey';
  var VKEY_URL = 'verification_key.json';

  async function loadVerificationKey() {
    if (cachedVkey) return cachedVkey;
    // The CSP forbids `connect-src` but WebViewAssetLoader serves
    // bundled assets via a same-origin synthetic request that doesn't
    // hit the network. snarkjs itself uses `fetch` internally for
    // the .wasm/.zkey load and the same exception applies.
    var resp = await fetch(VKEY_URL);
    if (!resp.ok) {
      throw new Error('failed to load verification_key.json (' + resp.status + ')');
    }
    cachedVkey = await resp.json();
    return cachedVkey;
  }

  function emitProgress(percent) {
    send({ type: 'progress', percent: percent | 0 });
  }

  async function generateProof(inputs) {
    if (typeof inputs !== 'object' || inputs === null) {
      throw new Error('inputs must be an object');
    }

    var biometricSecret = requireField('biometricSecret', inputs.biometricSecret);
    var salt = requireField('salt', inputs.salt);
    var didHashRaw = requireField('didHashRaw', inputs.didHashRaw);
    var sessionNonce = requireField('sessionNonce', inputs.sessionNonce);

    emitProgress(5);

    // Option B' fold — happens on-device, never leaves the WebView.
    var didHashSession = window.zaPoseidon2(didHashRaw, sessionNonce);
    var identityBinding = window.zaPoseidon2(biometricSecret, didHashSession);

    // The circuit's commitment constraint is commitment = Poseidon(secret, salt).
    // Either the host pre-supplied it (from the persisted credential) or we
    // recompute. Recomputing avoids a trust assumption on the host: even if
    // a malicious host passes a bad commitment, the witness derived here is
    // self-consistent and produces an honest proof.
    var commitment = window.zaPoseidon2(biometricSecret, salt);
    if (typeof inputs.commitment === 'string' && inputs.commitment.length > 0) {
      var expectedCommitment = BigInt(inputs.commitment);
      if (expectedCommitment !== commitment) {
        throw new Error(
          'host commitment does not match Poseidon(biometricSecret, salt)'
        );
      }
    }

    emitProgress(10);

    // The circuit's witness order: see circuits/identity_proof.circom.
    // Private: biometricSecret, salt. Public: commitment, didHash,
    // identityBinding — in that order. snarkjs reads them by name from
    // the witness object so dict order doesn't matter, but we mirror the
    // circom signal order for readability.
    var witness = {
      biometricSecret: biometricSecret.toString(10),
      salt:            salt.toString(10),
      commitment:      commitment.toString(10),
      didHash:         didHashSession.toString(10),
      identityBinding: identityBinding.toString(10)
    };

    emitProgress(20);

    // Tick progress while fullProve is running. snarkjs doesn't expose
    // a progress hook; we fake one with setInterval so the Kotlin side
    // can drive an indeterminate spinner without going silent. We cap
    // the synthetic progress at 75 so we still have room to bump to
    // 90 / 95 / 100 after the actual proof + verify lands.
    var fakePercent = 25;
    var ticker = setInterval(function () {
      if (fakePercent < 75) {
        fakePercent += 5;
        emitProgress(fakePercent);
      }
    }, 500);

    var start = Date.now();
    var proveResult;
    try {
      proveResult = await window.snarkjs.groth16.fullProve(witness, WASM_URL, ZKEY_URL);
    } finally {
      clearInterval(ticker);
    }
    var proofMs = Date.now() - start;

    emitProgress(80);

    var proof = proveResult.proof;
    var publicSignals = proveResult.publicSignals;

    // Self-verify before we ship the proof out. If this fails, the
    // host MUST NOT trust the proof — and the host enforces this by
    // surfacing `self_verify_failed` as a terminal exception.
    emitProgress(90);
    var vkey = await loadVerificationKey();
    var verifyOk = false;
    try {
      verifyOk = await window.snarkjs.groth16.verify(vkey, publicSignals, proof);
    } catch (verifyErr) {
      throw new Error('self-verify threw: ' + (verifyErr && verifyErr.message));
    }
    if (!verifyOk) {
      var err = new Error('snarkjs.groth16.verify returned false');
      err.code = 'self_verify_failed';
      throw err;
    }

    emitProgress(100);

    return {
      proof: proof,
      publicSignals: publicSignals,
      didHashSession: didHashSession.toString(10),
      identityBinding: identityBinding.toString(10),
      commitment: commitment.toString(10),
      proofMs: proofMs,
      verifyOk: true
    };
  }

  async function handleProveRequest(msg) {
    try {
      var data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      if (!data || data.type !== 'prove') {
        error('bad_request', 'unsupported message type: ' + (data && data.type));
        return;
      }
      var out = await generateProof(data.inputs || {});
      send({
        type: 'result',
        proof: out.proof,
        publicSignals: out.publicSignals,
        didHashSession: out.didHashSession,
        identityBinding: out.identityBinding,
        commitment: out.commitment,
        proofMs: out.proofMs,
        verifyOk: out.verifyOk
      });
    } catch (e) {
      var code = (e && e.code) || 'prove_failed';
      error(code, e && (e.message || String(e)));
    }
  }

  // Inbound channel: Kotlin calls webView.evaluateJavascript(
  // "window.zaHandleProve(<json>)"). We expose the handler on `window`
  // directly. A separate JS `message` listener is wired so postMessage
  // from outside the WebView (if the host ever switches transport)
  // also works.
  window.zaHandleProve = handleProveRequest;
  window.addEventListener('message', function (ev) {
    handleProveRequest(ev.data);
  });

  // Sanity probe — confirms poseidon + snarkjs are reachable before we
  // tell Kotlin we're ready. If either is missing, we surface a
  // structured error so the Android side fails the suspend fun with
  // ProverException(PROVER_FAILED) rather than timing out.
  function readyCheck() {
    if (typeof window.zaPoseidon2 !== 'function') {
      error('boot_failed', 'poseidon.js did not load');
      return false;
    }
    if (typeof window.snarkjs !== 'object' || !window.snarkjs.groth16) {
      error('boot_failed', 'snarkjs.min.js did not load');
      return false;
    }
    return true;
  }

  if (readyCheck()) {
    setStatus('prover: ready');
    send({ type: 'ready' });
  } else {
    setStatus('prover: boot failed');
  }
})();
