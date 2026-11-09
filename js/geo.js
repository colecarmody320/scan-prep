// Chart calibration maths (chart.json -> transform). Source pixel coordinates in, lon/lat out.
const R_NM = 3440.065; // mean Earth radius in nautical miles

function terms(type, x, y) {
  return type === 'affine' ? [1, x, y] : [1, x, y, x * x, x * y, y * y];
}

export class ChartGeo {
  constructor(chart) {
    this.t = chart.transform;
  }
  lonlat(x, y) {
    const v = terms(this.t.type, x, y);
    const [lonC, latC] = this.t.pixel_to_lonlat;
    let lon = 0, lat = 0;
    for (let i = 0; i < v.length; i++) { lon += lonC[i] * v[i]; lat += latC[i] * v[i]; }
    return { lon, lat };
  }
  pixel(lon, lat) {
    const v = terms(this.t.type, lon, lat);
    const [xC, yC] = this.t.lonlat_to_pixel;
    let x = 0, y = 0;
    for (let i = 0; i < v.length; i++) { x += xC[i] * v[i]; y += yC[i] * v[i]; }
    return { x, y };
  }
  // great-circle distance (NM) between two source pixels
  distNM(a, b) { return gcDist(this.lonlat(a.x, a.y), this.lonlat(b.x, b.y)); }
  // true course measured at the mid-point (as on a plotter laid over the mid-meridian), degrees 0..360
  trueCourse(a, b) {
    const A = this.lonlat(a.x, a.y), B = this.lonlat(b.x, b.y);
    const M = this.lonlat((a.x + b.x) / 2, (a.y + b.y) / 2);
    // bearing of the great circle at its midpoint = average of initial bearing from M to B and from A to M
    const b1 = bearing(A, M), b2 = bearing(M, B);
    return circMean(b1, b2);
  }
  // unit vector (source pixels) pointing to true north at a pixel
  northAt(x, y) {
    const ll = this.lonlat(x, y);
    const p = this.pixel(ll.lon, ll.lat + 0.01);
    const dx = p.x - x, dy = p.y - y, n = Math.hypot(dx, dy);
    return { x: dx / n, y: dy / n };
  }
  fmtLatLon(x, y) {
    const { lon, lat } = this.lonlat(x, y);
    return `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`;
  }
}

function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }
export function gcDist(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = p2 - p1, dl = rad(b.lon - a.lon);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(x)));
}
export function bearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function circMean(a, b) {
  const x = Math.cos(rad(a)) + Math.cos(rad(b)), y = Math.sin(rad(a)) + Math.sin(rad(b));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function dms(v, pos, neg) {
  const hemi = v >= 0 ? pos : neg; v = Math.abs(v);
  const d = Math.floor(v), m = (v - d) * 60;
  return `${d}°${m.toFixed(1).padStart(4, '0')}′${hemi}`;
}
