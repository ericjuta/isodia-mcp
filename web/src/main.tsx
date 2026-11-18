import { createRoot } from 'react-dom/client';
import { Dashboard } from './Dashboard';
import { ProjectPage } from './ProjectPage';
import { SharedPage } from './SharedPage';
import { WalkthroughPage } from './WalkthroughPage';
import { DialogHost } from './ui';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';

// Pages are fixed for the lifetime of a load; walkthrough steps use the query and history.
const [, section, id, mode] = window.location.pathname.split('/');

function page() {
  if (section === 'p' && id) return <ProjectPage projectId={decodeURIComponent(id)} />;
  if (section === 's' && id) return <SharedPage token={id} />;
  if (section === 'w' && id) return <WalkthroughPage id={id} embed={mode === 'embed'} />;
  return <Dashboard />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <>
      {page()}
      <DialogHost />
    </>
  );
}
