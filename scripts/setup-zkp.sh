#!/bin/bash
set -e

echo "========================================="
echo "  ZeroAuth ZKP Circuit Setup"
echo "  Patent Module 216 — Groth16 on BN128"
echo "========================================="

CIRCUIT_DIR="circuits"
BUILD_DIR="circuits/build"
PTAU_DIR="circuits/ptau"

mkdir -p "$BUILD_DIR" "$PTAU_DIR"

# Check for circom
if ! command -v circom &> /dev/null; then
  echo "[!] circom not found. Install from https://docs.circom.io/getting-started/installation/"
  echo "    curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh"
  echo "    git clone https://github.com/iden3/circom.git && cd circom && cargo build --release"
  echo "    sudo cp target/release/circom /usr/local/bin/"
  exit 1
fi

# Check for snarkjs
if ! command -v snarkjs &> /dev/null; then
  echo "[*] Installing snarkjs globally..."
  npm install -g snarkjs
fi

echo ""
echo "[1/6] Compiling circuit..."
circom "$CIRCUIT_DIR/identity_proof.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR" \
  -l node_modules

echo "[*] Circuit compiled. Constraints:"
snarkjs r1cs info "$BUILD_DIR/identity_proof.r1cs"

echo ""
echo "[2/6] Powers of Tau ceremony (BN128, power 14)..."
if [ ! -f "$PTAU_DIR/pot14_final.ptau" ]; then
  snarkjs powersoftau new bn128 14 "$PTAU_DIR/pot14_0000.ptau" -v
  snarkjs powersoftau contribute "$PTAU_DIR/pot14_0000.ptau" "$PTAU_DIR/pot14_0001.ptau" \
    --name="ZeroAuth Phase 1" -v -e="$(head -c 64 /dev/urandom | xxd -p)"
  snarkjs powersoftau prepare phase2 "$PTAU_DIR/pot14_0001.ptau" "$PTAU_DIR/pot14_final.ptau" -v
  echo "[*] Powers of Tau ceremony complete."
else
  echo "[*] Using existing ptau file."
fi

echo ""
echo "[3/6] Generating proving key (Groth16)..."
snarkjs groth16 setup "$BUILD_DIR/identity_proof.r1cs" "$PTAU_DIR/pot14_final.ptau" "$BUILD_DIR/circuit_0000.zkey"

echo ""
echo "[4/6] Contributing to phase 2..."
snarkjs zkey contribute "$BUILD_DIR/circuit_0000.zkey" "$BUILD_DIR/circuit_final.zkey" \
  --name="ZeroAuth Phase 2" -v -e="$(head -c 64 /dev/urandom | xxd -p)"

echo ""
echo "[5/6] Exporting verification key..."
snarkjs zkey export verificationkey "$BUILD_DIR/circuit_final.zkey" "$BUILD_DIR/verification_key.json"

echo ""
echo "[6/6] Generating Solidity verifier..."
snarkjs zkey export solidityverifier "$BUILD_DIR/circuit_final.zkey" "contracts/Verifier.sol"

echo ""
echo "========================================="
echo "  ZKP Setup Complete!"
echo ""
echo "  Artifacts:"
echo "    WASM:    $BUILD_DIR/identity_proof_js/identity_proof.wasm"
echo "    zkey:    $BUILD_DIR/circuit_final.zkey"
echo "    vkey:    $BUILD_DIR/verification_key.json"
echo "    Verifier: contracts/Verifier.sol"
echo "========================================="
