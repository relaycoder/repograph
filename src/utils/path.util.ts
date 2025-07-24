// An isomorphic path utility that provides a subset of `node:path` functionality
// and works in both Node.js and browser environments. It assumes POSIX-style
// paths ('/').

export const isomorphicPath = {
  normalize: (p: string) => p.replace(/\\/g, '/'),
  dirname: (p: string) => {
    const i = p.lastIndexOf('/');
    return i > -1 ? p.substring(0, i) : '.';
  },
  join: (...args: string[]): string => {
    const path = args.join('/');
    // This is a simplified resolver that handles '..' and '.'
    const segments = path.split('/');
    const resolved: string[] = [];
    for (const segment of segments) {
      if (segment === '..') {
        resolved.pop();
      } else if (segment !== '.' || resolved.length === 0) {
        if (segment !== '') resolved.push(segment);
      }
    }
    return resolved.join('/') || (segments.length > 0 && segments.every(s => s === '.' || s === '') ? '.' : '');
  },
  extname: (p: string) => {
    const i = p.lastIndexOf('.');
    return i > p.lastIndexOf('/') ? p.substring(i) : '';
  },
  parse: (p: string) => {
    const ext = isomorphicPath.extname(p);
    const base = p.substring(p.lastIndexOf('/') + 1);
    const name = base.substring(0, base.length - ext.length);
    const dir = isomorphicPath.dirname(p);
    return { dir, base, name, ext, root: '' };
  },
  basename: (p: string) => p.substring(p.lastIndexOf('/') + 1),
};