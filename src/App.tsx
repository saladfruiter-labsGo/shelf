import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout }       from './components/Layout'
import { Dashboard }    from './pages/Dashboard'
import { Library }      from './pages/Library'
import { LibraryGames } from './pages/LibraryGames'
import { LibraryBooks } from './pages/LibraryBooks'
import { LibraryFilms } from './pages/LibraryFilms'
import { LibrarySeries } from './pages/LibrarySeries'
import { LibraryMusic } from './pages/LibraryMusic'
import { Diary }        from './pages/Diary'
import { MediaDetail }  from './pages/MediaDetail'
import { Wrap }         from './pages/Wrap'
import { Settings }     from './pages/Settings'
import { Lists }        from './pages/Lists'
import { ListDetail }   from './pages/ListDetail'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index              element={<Dashboard />} />
            <Route path="library"    element={<Library />} />
            <Route path="library/games"  element={<LibraryGames />} />
            <Route path="library/books"  element={<LibraryBooks />} />
            <Route path="library/films"  element={<LibraryFilms />} />
            <Route path="library/series" element={<LibrarySeries />} />
            <Route path="library/music"  element={<LibraryMusic />} />
            <Route path="diary"      element={<Diary />} />
            <Route path="media/:id"  element={<MediaDetail />} />
            <Route path="wrap"       element={<Wrap />} />
            <Route path="settings"   element={<Settings />} />
            <Route path="lists"      element={<Lists />} />
            <Route path="lists/:id"  element={<ListDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
