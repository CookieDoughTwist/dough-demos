import { HashRouter, Routes, Route, NavLink, Link } from 'react-router-dom';

// 1. Automatically find all .jsx files in the jsx/ directory
const demoFiles = import.meta.glob('./jsx/*.jsx', { eager: true });

// 2. Transform them into an array of { name, component }
const demos = Object.keys(demoFiles).map((path) => {
  const name = path.match(/\.\/jsx\/(.*)\.jsx$/)[1];
  return {
    name,
    Component: demoFiles[path].default,
    path: `/${name}`
  };
});

const shellCss = `
  html, body { margin: 0; background: #0b0f19; }
  .shell-header {
    padding: 12px 16px 10px; border-bottom: 1px solid #1e293b;
    font-family: 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif;
  }
  .shell-title { color: #e2e8f0; text-decoration: none; font-size: 18px; font-weight: 600; }
  .shell-nav { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; scrollbar-width: none; }
  .shell-nav::-webkit-scrollbar { display: none; }
  .shell-nav a {
    flex: 0 0 auto; padding: 6px 12px; border-radius: 999px; font-size: 13px;
    color: #94a3b8; text-decoration: none; border: 1px solid #1e293b; background: #111827;
  }
  .shell-nav a.active { color: #e2e8f0; border-color: #3987e5; background: #1e3a5f; }
  .shell-home { padding: 20px 16px; color: #94a3b8; font-family: system-ui, sans-serif; }
`;

export default function App() {
  return (
    // HashRouter doesn't need "basename" because everything after # is local
    <HashRouter>
      <style>{shellCss}</style>
      <header className="shell-header">
        <Link to="/" className="shell-title">🍪 dough-demos</Link>
        <nav className="shell-nav">
          {demos.map(demo => (
            <NavLink key={demo.name} to={demo.path}>{demo.name}</NavLink>
          ))}
        </nav>
      </header>

      <Routes>
        <Route path="/" element={
          <div className="shell-home">
            <p>Select a demo above to start.</p>
            <p style={{ fontSize: '0.8em', color: '#64748b' }}>
              Currently hosting {demos.length} demos.
            </p>
          </div>
        } />
        {demos.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
      </Routes>
    </HashRouter>
  );
}
