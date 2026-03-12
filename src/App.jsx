import { HashRouter, Routes, Route, Link } from 'react-router-dom';

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

export default function App() {
  return (
    // HashRouter doesn't need "basename" because everything after # is local
    <HashRouter>
      <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <header>
          <h1><Link to="/">🍪 dough-demos</Link></h1>
          <nav style={{ marginBottom: '20px' }}>
            {demos.map(demo => (
              <Link key={demo.name} to={demo.path} style={{ marginRight: '15px' }}>
                {demo.name}
              </Link>
            ))}
          </nav>
        </header>
        <hr />

        <Routes>
          <Route path="/" element={
            <div>
              <p>Select an explainer above to start.</p>
              <p style={{ fontSize: '0.8em', color: '#666' }}>
                Currently hosting {demos.length} demos.
              </p>
            </div>
          } />
          {demos.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
        </Routes>
      </div>
    </HashRouter>
  );
}
