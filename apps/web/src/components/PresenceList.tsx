import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileSession } from '../collab/session';

interface Peer {
  clientId: number;
  name: string;
  color: string;
}

/** Other people currently in this file (from Yjs awareness). */
export function PresenceList({ session }: { session: FileSession }) {
  const { t } = useTranslation();
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    const awareness = session.provider.awareness;
    const update = () => {
      const list: Peer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as { name?: string; color?: string } | undefined;
        if (clientId !== awareness.clientID && user?.name) list.push({ clientId, name: user.name, color: user.color ?? '#888' });
      });
      setPeers(list);
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [session]);

  if (peers.length === 0) return null;
  return (
    <ul className="presence" aria-label={t('collab.here')} data-testid="presence">
      {peers.map((p) => (
        <li key={p.clientId} style={{ borderColor: p.color }} title={p.name}>
          <span className="presence-dot" style={{ background: p.color }} />
          {p.name}
        </li>
      ))}
    </ul>
  );
}
