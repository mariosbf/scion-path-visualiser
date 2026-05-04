import { Affix, SegmentedControl } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { session } from '../../lib/session';
import { TopologyView } from '../../components/TopologyView';
import { PathSearchView } from '../../components/PathSearchView';

type Mode = 'default' | 'path-search';

export function TopologyRoute() {
  const navigate = useNavigate();
  const topology = session.getTopology();
  const [mode, setMode] = useState<Mode>('default');

  useEffect(() => {
    if (!topology) {
      navigate({ to: '/setup' });
    }
  }, [topology, navigate]);

  if (!topology) return null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {mode === 'default' ? (
        <TopologyView topology={topology} />
      ) : (
        <PathSearchView topology={topology} />
      )}

      <Affix position={{ bottom: 20, left: 20 }}>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          data={[
            { value: 'default', label: 'Topology' },
            { value: 'path-search', label: 'Paths' },
          ]}
        />
      </Affix>
    </div>
  );
}
