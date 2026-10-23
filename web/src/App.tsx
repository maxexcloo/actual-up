import { Center, Loader } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../../src/api.js";
import { signedOutEvent } from "./api";
import { Dashboard } from "./Dashboard";
import { Login } from "./Login";
import { Shell } from "./Shell";

/** Poll the server's state; the browser keeps no copy of settings or credentials. */
export function App() {
  const [state, setState] = useState<AppState>();
  const [signedIn, setSignedIn] = useState<boolean>();
  const etag = useRef<string>(undefined);

  const signOut = useCallback(() => {
    etag.current = undefined;
    setState(undefined);
    setSignedIn(false);
  }, []);
  const refresh = useCallback(async () => {
    let response: Response;
    try {
      response = await fetch("/state", {
        headers: etag.current ? { "if-none-match": etag.current } : {},
      });
    } catch {
      return;
    }
    if (response.status === 401) return signOut();
    if (response.status === 304 || !response.ok) return;
    etag.current = response.headers.get("etag") ?? undefined;
    setState(await response.json());
    setSignedIn(true);
  }, [signOut]);

  useEffect(() => {
    window.addEventListener(signedOutEvent, signOut);
    return () => window.removeEventListener(signedOutEvent, signOut);
  }, [signOut]);
  useEffect(() => {
    if (signedIn === false) return;
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [signedIn, refresh]);

  if (signedIn === false)
    return (
      <Shell>
        <Login onSignedIn={() => setSignedIn(undefined)} />
      </Shell>
    );
  if (!state)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  return (
    <Shell onSignOut={signOut}>
      <Dashboard state={state} refresh={refresh} />
    </Shell>
  );
}
