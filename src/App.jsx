import PidDemo from './jsx/pid-demo'

export default function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>🍪 dough-demos</h1>
      <p>Quick & dirty logic visualizations.</p>
      <hr />
      {/* Swap this out whenever you add a new demo */}
      <PidDemo />
    </div>
  )
}
