/** Strict parsing only; syntactic validity does not establish a trusted source. */
export function canonicalAddress(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value)) {
    return value.split('.').every(part=>Number(part)<=255) ? value : null;
  }
  if (!value.includes(':') || !/^[a-fA-F0-9:.]+$/.test(value)) return null;
  // Reject ambiguous embedded IPv4 before WHATWG URL normalizes it.
  if (value.includes('.') && !canonicalAddress(value.slice(value.lastIndexOf(':')+1))) return null;
  try {
    const address=new URL(`http://[${value}]/`).hostname.slice(1,-1).toLowerCase();
    const mapped=address.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
    if (mapped) {
      const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);
      return `${high>>>8}.${high&255}.${low>>>8}.${low&255}`;
    }
    return address;
  } catch { return null; }
}

/** Keep mode unset until this deployment's ingress overwrite guarantee is verified.
 * Never accept the mode from the request, or fall back to caller-supplied XFF.
 */
export function readVerifiedAddress(request, mode) {
  return mode==='cloudflare-verified' ? canonicalAddress(request.headers.get('CF-Connecting-IP')) : null;
}

export function createDailyAddressHasher(secret) {
  const encoder=new TextEncoder();
  if (typeof secret!=='string' || encoder.encode(secret).length<32) throw new Error('Invalid hash configuration');
  const key=crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return async (value,date)=>{
    const address=canonicalAddress(value);
    if (!address || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) {
      throw new Error('Invalid hash input');
    }
    const message=encoder.encode(`dekiru/shared-read/v1\n${date}\n${address}`);
    const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',await key,message));
    return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  };
}
