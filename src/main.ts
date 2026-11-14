import { revealKindSchema } from '../shared/schema';
import { mountAdmin } from './admin/admin';
import { mountReveal } from './reveal/page';
import './styles.css';

function route(root: HTMLElement): void {
  const segments = window.location.pathname.split('/').filter((segment) => segment.length > 0);

  if (segments[0] === 'r' && segments.length === 2) {
    const preview = new URLSearchParams(window.location.search).has('preview');
    mountReveal(root, { type: 'token', token: decodeURIComponent(segments[1]), preview });
    return;
  }

  if (segments[0] === 'preview' && segments.length === 2) {
    const kind = revealKindSchema.safeParse(segments[1]);
    if (kind.success) {
      mountReveal(root, { type: 'preview', reveal: kind.data });
      return;
    }
  }

  mountAdmin(root);
}

const root = document.getElementById('app');
if (root) route(root);
