/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import AdminDashboard from './views/AdminDashboard';
import AdminLogin from './views/AdminLogin';
import PublicResults from './views/PublicResults';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import { ProtectedRoute, GuestRoute, VotingRoute, AdminRoute } from './components/ProtectedRoute';

import Login from './views/Login';
import Verify from './views/Verify';
import VotingBooth from './views/VotingBooth';
import Results from './views/Results';
import ElectionBot from './components/ElectionBot'; // <-- 1. Import the Bot

export default function App() {
  return (
      <AuthProvider>
        <Router>
          <Routes>
            <Route element={<Layout />}>

              {/* Fully public — no auth required */}
              <Route path="/election-results" element={<PublicResults />} />

              {/* Admin login — public but separate from voter login */}
              <Route path="/admin/login" element={<AdminLogin />} />

              {/* Guest-only routes */}
              <Route element={<GuestRoute />}>
                <Route path="/login" element={<Login />} />
                <Route path="/verify" element={<Verify />} />
              </Route>

              {/* Voting route — authenticated and hasn't voted */}
              <Route element={<VotingRoute />}>
                <Route path="/voting-booth" element={<VotingBooth />} />
              </Route>

              {/* Protected route — authenticated */}
              <Route element={<ProtectedRoute />}>
                <Route path="/results" element={<Results />} />
              </Route>

              {/* Admin route — requires admin session */}
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminDashboard />} />
              </Route>

              <Route path="*" element={<Navigate to="/login" replace />} />
            </Route>
          </Routes>

          {/* <-- 2. Render the bot globally above all routes --> */}
          <ElectionBot />

        </Router>
      </AuthProvider>
  );
}