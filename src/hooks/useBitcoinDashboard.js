import { useEffect, useState } from 'react';
import { getDashboard } from '../services/api.js';

export function useBitcoinDashboard() {
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const eventSource = new EventSource('/api/events');

    getDashboard()
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setError('');
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message);
      });

    eventSource.addEventListener('snapshot', (event) => {
      if (!active) return;
      try {
        setSnapshot(JSON.parse(event.data));
        setConnection('connected');
        setError('');
      } catch {
        setError('Received an invalid network update.');
      }
    });

    eventSource.addEventListener('status', (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data);
        setConnection(payload.status || 'connecting');
        if (payload.status === 'stale' || payload.status === 'disconnected') {
          setError(payload.message || 'Live data is temporarily unavailable.');
        }
      } catch {
        setConnection('degraded');
      }
    });

    eventSource.onopen = () => {
      if (active) setConnection('connected');
    };

    eventSource.onerror = () => {
      if (active) setConnection('reconnecting');
      // EventSource automatically retries when the connection is interrupted.
    };

    return () => {
      active = false;
      eventSource.close();
    };
  }, []);

  return { snapshot, connection, error };
}
