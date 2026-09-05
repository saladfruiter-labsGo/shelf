import { useNavigate } from 'react-router-dom'

export function LibraryMusic() {
  const navigate = useNavigate()

  return (
    <div style={{ background: '#FFF9F5', color: '#111018', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1200, margin: '0 auto' }}>
        <button
          onClick={() => navigate('/library')}
          style={{ fontSize: 12, color: '#8878A0', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
        >
          ← Biblioteca
        </button>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: '#FF2D6B', marginBottom: 16 }}>
          Músicas
        </p>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: '#111018', marginBottom: 40 }}>
          Minhas músicas
        </h1>
      </div>

      {/* Coming soon */}
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 64px 80px', textAlign: 'center' }}>
        <div style={{ fontSize: 80, marginBottom: 32 }}>🎵</div>
        <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 700, color: '#111018', marginBottom: 16 }}>
          Em breve
        </p>
        <p style={{ fontSize: 15, color: '#8878A0', lineHeight: 1.6 }}>
          O rastreamento de álbuns e músicas está em desenvolvimento. Em breve você poderá adicionar seus álbuns favoritos à sua prateleira.
        </p>
        <div style={{
          marginTop: 40, padding: '24px', background: 'rgba(255,45,107,.06)',
          border: '1px solid rgba(255,45,107,.15)', borderRadius: 16, textAlign: 'left',
        }}>
          <p style={{ fontSize: 13, color: '#FF2D6B', fontWeight: 600, marginBottom: 8 }}>Tipos suportados</p>
          <p style={{ fontSize: 13, color: '#8878A0', lineHeight: 1.5 }}>
            Atualmente o Shelved suporta Filmes, Séries, Jogos e Livros via APIs externas (TMDB, RAWG, Google Books).
          </p>
        </div>
      </div>
    </div>
  )
}
