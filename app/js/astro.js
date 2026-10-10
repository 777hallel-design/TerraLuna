// Rise and set times of the moon and sun for a place on earth.
// Low-precision formulas from the Astronomical Almanac (moon ~0.3°, sun ~0.01°),
// good to about two minutes. The sowing data itself comes from Swiss Ephemeris;
// this only adds the local, place-dependent times.

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const jd = (unix) => unix / 86400 + 2440587.5;

function moonEcliptic(t) {
  const T = (jd(t) - 2451545) / 36525;
  const lon = 218.32 + 481267.881 * T
    + 6.29 * sin(135.0 + 477198.87 * T) - 1.27 * sin(259.3 - 413335.36 * T)
    + 0.66 * sin(235.7 + 890534.22 * T) + 0.21 * sin(269.9 + 954397.74 * T)
    - 0.19 * sin(357.5 + 35999.05 * T) - 0.11 * sin(186.5 + 966404.03 * T);
  const lat = 5.13 * sin(93.3 + 483202.02 * T) + 0.28 * sin(228.2 + 960400.89 * T)
    - 0.28 * sin(318.3 + 6003.15 * T) - 0.17 * sin(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * cos(135.0 + 477198.87 * T) + 0.0095 * cos(259.3 - 413335.36 * T)
    + 0.0078 * cos(235.7 + 890534.22 * T) + 0.0028 * cos(269.9 + 954397.74 * T);
  return { lon, lat, par };
}

function sunEcliptic(t) {
  const n = jd(t) - 2451545;
  const L = 280.460 + 0.9856474 * n;
  const g = 357.528 + 0.9856003 * n;
  return { lon: L + 1.915 * sin(g) + 0.020 * sin(2 * g), lat: 0 };
}

function equatorial({ lon, lat }, t) {
  const eps = 23.439 - 0.0000004 * (jd(t) - 2451545);
  const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * RAD) * sin(eps), cos(lon)) / RAD;
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) / RAD;
  return { ra, dec };
}

function altitude(eq, t, place) {
  const gmst = 280.46061837 + 360.98564736629 * (jd(t) - 2451545);
  const H = gmst + place.lon - eq.ra;
  return Math.asin(sin(place.lat) * sin(eq.dec) + cos(place.lat) * cos(eq.dec) * cos(H)) / RAD;
}

// Altitude above the standard rising altitude: upper limb with refraction,
// and for the moon also its parallax (Meeus, chapter 15).
function aboveHorizon(body, t, place) {
  if (body === 'moon') {
    const e = moonEcliptic(t);
    return altitude(equatorial(e, t), t, place) - (0.7275 * e.par - 0.5667);
  }
  return altitude(equatorial(sunEcliptic(t), t, place), t, place) + 0.8333;
}

/** Rise and set times (unix seconds) of `body` between a and b. */
export function riseSet(body, a, b, place) {
  const step = 600;
  const out = { rise: [], set: [] };
  let t0 = a;
  let f0 = aboveHorizon(body, t0, place);
  while (t0 < b) {
    const t1 = Math.min(t0 + step, b);
    const f1 = aboveHorizon(body, t1, place);
    if ((f0 < 0) !== (f1 < 0)) {
      let lo = t0;
      let hi = t1;
      while (hi - lo > 10) {
        const m = (lo + hi) / 2;
        if ((aboveHorizon(body, m, place) < 0) === (f0 < 0)) lo = m; else hi = m;
      }
      out[f0 < 0 ? 'rise' : 'set'].push(Math.round((lo + hi) / 2));
    }
    t0 = t1;
    f0 = f1;
  }
  return out;
}

export function isUp(body, t, place) {
  return aboveHorizon(body, t, place) > 0;
}

export const PLACES = [
  { id: 'jerusalem', lat: 31.7683, lon: 35.2137, name: { he: 'ירושלים', en: 'Jerusalem' } },
  { id: 'tel-aviv', lat: 32.0853, lon: 34.7818, name: { he: 'תל אביב', en: 'Tel Aviv' } },
  { id: 'haifa', lat: 32.794, lon: 34.9896, name: { he: 'חיפה', en: 'Haifa' } },
  { id: 'beer-sheva', lat: 31.2518, lon: 34.7913, name: { he: 'באר שבע', en: 'Beersheba' } },
  { id: 'eilat', lat: 29.5577, lon: 34.9519, name: { he: 'אילת', en: 'Eilat' } },
  { id: 'tiberias', lat: 32.7922, lon: 35.5312, name: { he: 'טבריה', en: 'Tiberias' } },
  { id: 'safed', lat: 32.9646, lon: 35.496, name: { he: 'צפת', en: 'Safed' } },
  { id: 'kiryat-shmona', lat: 33.2073, lon: 35.5702, name: { he: 'קריית שמונה', en: 'Kiryat Shmona' } },
];
