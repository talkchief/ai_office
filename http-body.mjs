// Count bytes before decoding so split UTF-8 characters remain intact.
export function readJsonBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true; chunks.length = 0;
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
    });
    req.on('aborted', () => reject(Object.assign(new Error('Request interrupted.'), { status: 400 })));
    req.on('error', reject);
  });
}

// The raw bytes, for webhooks whose signature covers the body exactly as sent. Same chunk, limit and abort handling as above.
export function readRawBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) { failed = true; chunks.length = 0; reject(Object.assign(new Error('Request is too large.'), { status: 413 })); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('aborted', () => reject(Object.assign(new Error('Request interrupted.'), { status: 400 })));
    req.on('error', reject);
  });
}
