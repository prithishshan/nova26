import { useEffect, useState } from "react";
import { api, type Health } from "./api";
import Operations from "./Operations";
import Workspace from "./Workspace";
import Policies from "./Policies";

type View = "ops" | "case" | "policies";

export default function App() {
  const [view, setView] = useState<View>(() => (window.location.hash === "#case" ? "case" : window.location.hash === "#policies" ? "policies" : "ops"));
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () => api.health()
      .then(h => { if (alive) { setHealth(h); setHealthErr(false); } })
      .catch(() => { if (alive) setHealthErr(true); });
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setView("ops")} role="button">
          <span className="logo">nova26</span>
        </div>
        <nav className="topnav">
          <button className={`navlink ${view !== "policies" ? "on" : ""}`} onClick={() => setView("ops")}>Operations</button>
          <button className={`navlink ${view === "policies" ? "on" : ""}`} onClick={() => setView("policies")}>Payer policies</button>
        </nav>
        <div className="topbar-spacer" aria-hidden="true" />
      </header>
      <div className="shell">
        <main className="main">
          {view === "ops" && <Operations onOpenHero={() => setView("case")} />}
          {view === "case" && <Workspace health={health} onBack={() => setView("ops")} />}
          {view === "policies" && <Policies />}
        </main>
      </div>
    </div>
  );
}

