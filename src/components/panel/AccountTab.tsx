import { useState, type SyntheticEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { authError } from '../../lib/authErrors';

const BUCKETS = ['listing-images', 'business-media'] as const;

/** Lista recursivamente los archivos bajo una carpeta del bucket (las subcarpetas vienen con id null). */
async function listFiles(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    if (!data?.length) break;
    for (const f of data) {
      if (f.id) out.push(`${prefix}/${f.name}`);
      else out.push(...(await listFiles(bucket, `${prefix}/${f.name}`)));
    }
    if (data.length < 100) break;
  }
  return out;
}

async function removeUserFiles(userId: string) {
  for (const bucket of BUCKETS) {
    const files = await listFiles(bucket, userId);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(files.slice(i, i + 100));
      if (error) throw error;
    }
  }
}

export default function AccountTab({ user }: { user: User }) {
  const hasPassword = (user.identities ?? []).some((i) => i.provider === 'email');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessMsg, setSessMsg] = useState('');
  const [word, setWord] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState('');

  async function changePassword(e: SyntheticEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (password !== confirm) { setPwMsg({ ok: false, text: 'Las contraseñas no coinciden.' }); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setPwMsg({ ok: false, text: authError(error) });
    else { setPwMsg({ ok: true, text: 'Contraseña actualizada.' }); setPassword(''); setConfirm(''); }
    setPwBusy(false);
  }

  async function logoutEverywhere() {
    setSessMsg('');
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) setSessMsg(authError(error));
    else location.href = '/ingresar';
  }

  async function deleteAccount(e: SyntheticEvent) {
    e.preventDefault();
    if (word !== 'ELIMINAR') return;
    setDelBusy(true);
    setDelError('');
    try {
      await removeUserFiles(user.id);
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      await supabase.auth.signOut({ scope: 'local' });
      location.href = '/';
    } catch {
      setDelError('No pudimos eliminar tu cuenta. Inténtalo de nuevo; si persiste, contáctanos.');
      setDelBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-1 p-6">
        <h2 className="text-lg font-bold">Tu cuenta</h2>
        <p className="text-sm text-muted">Correo</p>
        <p className="font-semibold">{user.email}</p>
      </section>

      {hasPassword && (
        <form onSubmit={changePassword} className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">Cambiar contraseña</h2>
          <div><label className="label" htmlFor="acc-pass">Nueva contraseña</label>
            <input id="acc-pass" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="mt-1 text-xs text-muted">Mínimo 8 caracteres.</p></div>
          <div><label className="label" htmlFor="acc-confirm">Confirma la contraseña</label>
            <input id="acc-confirm" className="input" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
          {pwMsg && <p role={pwMsg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${pwMsg.ok ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>{pwMsg.text}</p>}
          <button className="btn btn-primary" disabled={pwBusy}>{pwBusy ? 'Guardando…' : 'Guardar contraseña'}</button>
        </form>
      )}

      <section className="card space-y-3 p-6">
        <h2 className="text-lg font-bold">Sesiones</h2>
        <p className="text-sm text-muted">Cierra tu sesión en todos los dispositivos donde hayas ingresado, incluido este.</p>
        {sessMsg && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sessMsg}</p>}
        <button type="button" onClick={logoutEverywhere} className="btn btn-outline">Cerrar sesión en todos los dispositivos</button>
      </section>

      <form onSubmit={deleteAccount} className="card space-y-3 border-red-200 p-6">
        <h2 className="text-lg font-bold text-red-700">Zona de peligro</h2>
        <p className="text-sm text-muted">
          Eliminar tu cuenta borra de forma permanente tu negocio, tus publicaciones y todas tus imágenes. Esta acción no se puede deshacer.
        </p>
        <div><label className="label" htmlFor="acc-del">Escribe <strong>ELIMINAR</strong> para confirmar</label>
          <input id="acc-del" className="input" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" /></div>
        {delError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{delError}</p>}
        <button className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50" disabled={word !== 'ELIMINAR' || delBusy}>
          {delBusy ? 'Eliminando…' : 'Eliminar mi cuenta'}
        </button>
      </form>
    </div>
  );
}
