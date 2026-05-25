# ZeroAuth Android — release signing

One-time operator setup so `.github/workflows/android.yml`'s `release`
job can produce a signed AAB + APK on tag pushes and on
`workflow_dispatch` with `release=true`.

## Prerequisites

- A laptop with a JDK 17+ installed (the Gradle build's `keytool`
  comes from the JDK).
- Access to the `zeroauth-dev/ZeroAuth` repo's GitHub Actions
  secret store (Settings → Secrets and variables → Actions).
- A password manager. The four secrets are credentials that sign
  every binary we ship; they live in 1Password / Bitwarden, never
  in the repo.

## 1. Generate the release keystore (once, ever)

```bash
keytool -genkeypair \
  -v \
  -keystore zeroauth-android-release.jks \
  -keyalg RSA \
  -keysize 4096 \
  -validity 25000 \
  -alias zeroauth-android-release \
  -storetype JKS \
  -dname "CN=ZeroAuth Android, O=ZeroAuth, L=Bengaluru, ST=Karnataka, C=IN"
```

`keytool` prompts for two passwords — the **store password** (gate
for opening the .jks file) and the **key password** (gate for the
alias inside). They can be the same string in practice; many
operators choose to. Capture both in your password manager **right
now** — losing them means every previously-signed build can no
longer be upgraded in place on a user's phone, and the only
recovery is publishing a new package name and asking users to
reinstall.

Validity = 25,000 days (~68 years). Google Play's upload-key
requirements ask for a key valid past 2033; this comfortably clears.

**Back up the .jks file**:

- Drop a copy into 1Password as a file attachment on the
  "ZeroAuth Android release keystore" item.
- Optionally, drop a second copy onto a Yubikey or hardware token
  that lives in the office safe. Belt and braces — losing this key
  is unrecoverable.

## 2. Stage the four GitHub Actions secrets

The release job reads four secrets. Encode the keystore as base64
so it round-trips cleanly through the GH secret store, then paste
the four into the repo settings.

```bash
# 2a. base64-encode the keystore (single line, no newlines)
base64 -i zeroauth-android-release.jks | tr -d '\n' | pbcopy
# `pbcopy` puts it on the macOS clipboard. Paste straight into the
# secret value field below. On Linux: pipe to `xclip -selection clipboard`.
```

Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | the base64 string from above |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | the store password you typed into `keytool` |
| `ANDROID_RELEASE_KEY_ALIAS` | `zeroauth-android-release` (or whatever `-alias` you used) |
| `ANDROID_RELEASE_KEY_PASSWORD` | the key password you typed into `keytool` |

GitHub treats secret values as opaque — the base64 stays safe even
on a public build log because the workflow's `Restore release
keystore` step never echoes it; it just decodes into a temp file
and removes the temp file in an `always()` cleanup step.

## 3. Trigger a release build

Two paths:

**Path A — workflow_dispatch (manual one-off):**

Actions → "Android CI" → "Run workflow" → set `release` to `true`.

**Path B — tag push (every versioned release):**

```bash
git tag android-v0.1.0
git push origin android-v0.1.0
```

Either path runs the existing `build` job (compile + unit tests +
lint + verifyProverAssets), then runs `release` to produce two
artifacts:

| Artifact name | What it is | Use for |
|---|---|---|
| `zeroauth-android-release-aab` | `.aab` (App Bundle) | Play Console internal track upload |
| `zeroauth-android-release-apk` | `.apk` | Direct sideload to a demo phone |

Both retained for 90 days on the workflow run page.

## 4. Sideload the signed APK to a demo phone

```bash
# Download the zeroauth-android-release-apk artifact from the workflow run
unzip zeroauth-android-release-apk.zip
adb install -r app-release.apk
```

`-r` allows reinstalling over an existing build (Android requires
the new APK to be signed with the SAME keystore — that's the whole
point of step 1 being a one-time operation).

## 5. Upload the signed AAB to Play Console (when ready)

Play Console → ZeroAuth Android → Testing → Internal testing →
Releases → Create new release → upload the `.aab`. The first time,
Play Console asks you to confirm the upload-key fingerprint —
match it against:

```bash
keytool -list -v -keystore zeroauth-android-release.jks -alias zeroauth-android-release \
  | grep SHA-256
```

After this first match, every subsequent release auto-validates
against the stored fingerprint.

## Rotation playbook

If the keystore is ever exposed (machine theft, accidental commit,
malicious insider):

1. Generate a NEW keystore via step 1, with a NEW alias (e.g.,
   `zeroauth-android-release-2`).
2. Replace the four GH secrets via step 2.
3. Bump `applicationId` in `android/app/build.gradle.kts` to a NEW
   value (e.g., `dev.zeroauth.android.v2`) — Android prevents
   upgrading an installed app to one signed with a different key,
   so a new applicationId is required for the next release to be
   installable.
4. Ship a comms note to existing users: "uninstall the old build,
   install the new one from this Play Store link."

Rotation is painful but recoverable. The "must rotate" trigger is
not "the keystore left the safe" — it's "the password is in a known
attacker's hands." A keystore alone, without its password, is
useless to an attacker.

## Audit trail

Every signed release shows up under Actions → Android CI → runs
filtered by `release` job. The `Restore release keystore` step
logs nothing more than "keystore present" / "absent"; the
`Wipe keystore from runner` step always runs even when the build
fails. No keystore bytes ever touch the persistent runner cache.
