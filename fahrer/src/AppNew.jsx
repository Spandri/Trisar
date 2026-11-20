import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

// Pages
import DriverApp from './pages/driver/DriverApp';
import DispatcherApp from './pages/dispatcher/DispatcherApp';
import CoordinatorApp from './pages/coordinator/CoordinatorApp';
import GuestApp from './pages/guest/GuestApp';

// Protected Route for authenticated users
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { session, role, authLoading } = useAuth();

  if (authLoading) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><p className="text-white">Loading...</p></div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Login placeholder (wird später implementiert)
const LoginPage = () => {
  const { login, authError } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await login(email, password);
    if (success) {
      // Router wird automatisch aktualisiert durch Session
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#161618] rounded-2xl p-8 border border-[#222224]">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">Trisar</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#222224] rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#d4ff28]"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#222224] rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-[#d4ff28]"
            required
          />
          {authError && <p className="text-red-500 text-sm">{authError}</p>}
          <button
            type="submit"
            className="w-full bg-[#d4ff28] text-black font-bold py-3 rounded-xl hover:bg-[#c3ec20] transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
};

function AppRoutes() {
  const { session } = useAuth();

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/track/:jobId" element={<GuestApp />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Driver */}
      <Route
        path="/driver/*"
        element={
          <ProtectedRoute allowedRoles={['driver']}>
            <DriverApp />
          </ProtectedRoute>
        }
      />

      {/* Dispatcher */}
      <Route
        path="/dispatcher/*"
        element={
          <ProtectedRoute allowedRoles={['dispatcher', 'coordinator']}>
            <DispatcherApp />
          </ProtectedRoute>
        }
      />

      {/* Coordinator */}
      <Route
        path="/coordinator/*"
        element={
          <ProtectedRoute allowedRoles={['coordinator']}>
            <CoordinatorApp />
          </ProtectedRoute>
        }
      />

      {/* Guest Tracking */}
      <Route path="/track/:jobId" element={<GuestApp />} />

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/driver" replace />} />
      <Route path="*" element={<Navigate to="/driver" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
