import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Landing from './routes/Landing';
import SignIn from './routes/SignIn';
import SignUp from './routes/SignUp';
import Dashboard from './routes/Dashboard';

// NeoBank — three-route investor demo:
//   /          marketing landing ("login everywhere, no passwords")
//   /signin    biometric sign-in ceremony — REAL flow against the
//              /api/demo-portal/* shim (which itself wraps
//              /v1/proof-pairing/sessions). The QR rendered here is a
//              live pairing payload; scanning it with the mobile app +
//              approving the biometric will mint the demo_portal_session
//              cookie via SSE and redirect to /dashboard.
//   /dashboard signed-in account home (NeoBank account view)
//
// Everything here except the actual auth pipeline is fictional. NeoBank
// does not exist; it's a stand-in so investors can see what a consumer
// surface looks like once ZeroAuth replaces username/password. The
// cryptography under /signin is real ZeroAuth though — same snarkjs
// Groth16 proof verification path the e2e ceremony test exercises.

export function App() {
  return (
    <BrowserRouter basename="/bank-demo">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
