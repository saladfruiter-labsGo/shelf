import { lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout }       from './components/Layout'
import { MediaPreviewProvider } from './components/MediaSummaryModal'

const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })))
const Library = lazy(() => import('./pages/Library').then(module => ({ default: module.Library })))
const LibraryGames = lazy(() => import('./pages/LibraryGames').then(module => ({ default: module.LibraryGames })))
const LibraryBooks = lazy(() => import('./pages/LibraryBooks').then(module => ({ default: module.LibraryBooks })))
const LibraryFilms = lazy(() => import('./pages/LibraryFilms').then(module => ({ default: module.LibraryFilms })))
const LibrarySeries = lazy(() => import('./pages/LibrarySeries').then(module => ({ default: module.LibrarySeries })))
const LibraryMusic = lazy(() => import('./pages/LibraryMusic').then(module => ({ default: module.LibraryMusic })))
const Diary = lazy(() => import('./pages/Diary').then(module => ({ default: module.Diary })))
const Wishlist = lazy(() => import('./pages/Wishlist').then(module => ({ default: module.Wishlist })))
const MediaDetail = lazy(() => import('./pages/MediaDetail').then(module => ({ default: module.MediaDetail })))
const Wrap = lazy(() => import('./pages/Wrap').then(module => ({ default: module.Wrap })))
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })))
const Integrations = lazy(() => import('./pages/Integrations').then(module => ({ default: module.Integrations })))
const ImportExport = lazy(() => import('./pages/ImportExport').then(module => ({ default: module.ImportExport })))
const Lists = lazy(() => import('./pages/Lists').then(module => ({ default: module.Lists })))
const ListDetail = lazy(() => import('./pages/ListDetail').then(module => ({ default: module.ListDetail })))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MediaPreviewProvider>
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
              <Route path="wishlist"   element={<Wishlist />} />
              <Route path="media/:id"  element={<MediaDetail />} />
              <Route path="wrap"       element={<Wrap />} />
              <Route path="settings"   element={<Settings />} />
              <Route path="integrations"  element={<Integrations />} />
              <Route path="import-export" element={<ImportExport />} />
              <Route path="lists"      element={<Lists />} />
              <Route path="lists/:id"  element={<ListDetail />} />
            </Route>
          </Routes>
        </MediaPreviewProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
