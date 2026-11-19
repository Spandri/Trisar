// Faengt Abstuerze beim Anzeigen ab: statt einer schwarzen Seite steht der Fehler da,
// mit "Neu laden" und "Zur Startseite" (setzt die gemerkte Ansicht zurueck).
import { Component } from 'react';

export default class FehlerGrenze extends Component {
  constructor(props) {
    super(props);
    this.state = { fehler: null };
  }

  static getDerivedStateFromError(fehler) {
    return { fehler };
  }

  componentDidCatch(fehler, info) {
    console.error('TRISAR Absturz:', fehler, info?.componentStack);
  }

  render() {
    const { fehler } = this.state;
    if (!fehler) return this.props.children;
    const knopf = { height: 48, padding: '0 16px', fontWeight: 700, fontSize: 15, fontFamily: 'Space Grotesk', cursor: 'pointer' };
    return (
      <div style={{ minHeight: 'var(--app-h, 100dvh)', background: '#000', color: '#fff', fontFamily: 'Space Grotesk', padding: '60px 20px' }}>
        <div style={{ maxWidth: 362, margin: '0 auto' }}>
          <div style={{ color: '#E3F654', fontSize: 32, fontWeight: 700 }}>Da ist etwas schiefgelaufen</div>
          <div style={{ marginTop: 16, color: '#ff6f63', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {String(fehler?.message || fehler)}
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
            <button type="button" style={{ ...knopf, background: '#E3F654', color: '#000', border: 0 }} onClick={() => window.location.reload()}>
              Neu laden
            </button>
            <button
              type="button"
              style={{ ...knopf, background: 'transparent', color: '#E3F654', border: '2px solid #E3F654' }}
              onClick={() => {
                try { window.history.replaceState({}, ''); window.sessionStorage.removeItem('trisar.fahrerAnsicht.v1'); } catch { /* egal */ }
                window.location.reload();
              }}
            >
              Zur Startseite
            </button>
          </div>
        </div>
      </div>
    );
  }
}
