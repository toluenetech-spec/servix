import { useEffect, useRef, useState } from 'react';

/**
 * Small data-fetching hook wrapping the data layer.
 * Provides the loading / error / data states every listing and detail
 * page uses. Works identically once the data layer talks to a real API.
 *
 * @param {Function} fetcher  async function returning data
 * @param {Array}    deps     dependency list that re-triggers the fetch
 */
export function useFetch(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const retry = () => setTick((t) => t + 1);

  return { ...state, retry };
}
