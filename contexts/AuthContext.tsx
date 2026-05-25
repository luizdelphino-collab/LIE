import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User as FbUser } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { AppUser } from '../types';

interface AuthContextValue {
  fbUser: FbUser | null;
  appUser: AppUser | null;
  loading: boolean;
  primeiroAcesso: boolean;
  signOut: () => Promise<void>;
  updateAppUser: (data: Partial<AppUser & { primeiroAcesso?: boolean }>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<FbUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [primeiroAcesso, setPrimeiroAcesso] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFbUser(user);
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const data = snap.data() as any;
          setAppUser({ uid: user.uid, ...(data as Omit<AppUser, 'uid'>) });
          setPrimeiroAcesso(data.primeiroAcesso === true);
        } else {
          setAppUser(null);
          setPrimeiroAcesso(false);
        }
      } else {
        setAppUser(null);
        setPrimeiroAcesso(false);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signOut = async () => {
    await fbSignOut(auth);
  };

  const updateAppUser = (data: Partial<AppUser & { primeiroAcesso?: boolean }>) => {
    if (data.primeiroAcesso !== undefined) {
      setPrimeiroAcesso(data.primeiroAcesso);
    }
    setAppUser(prev => prev ? { ...prev, ...data } : prev);
  };

  return (
    <AuthContext.Provider value={{ fbUser, appUser, loading, primeiroAcesso, signOut, updateAppUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve estar dentro de <AuthProvider>');
  return ctx;
}
