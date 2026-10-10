#!/usr/bin/env python3
"""Generate TerraLuna lunar data with the Swiss Ephemeris.

For every year this writes app/data/<year>.json containing the raw lunar
events the app needs. Everything is in UTC (unix seconds); the app converts
to the viewer's time zone.

  signs     : moon ingress into a sidereal sign (equal 30 degree signs)
  phases    : new moon, first quarter, full moon, last quarter
  nodes     : moon crossing the ecliptic (ascending / descending node)
  apsides   : perigee / apogee
  decl      : turning points of the moon's declination
              (min -> start of the ascending moon, max -> start of descending)
  eclipses  : solar / lunar eclipses (time of maximum)

Usage:  python ephemeris/generate.py --from 2020 --to 2040 [--ayanamsa lahiri]
"""
import argparse
import json
import os
from datetime import datetime, timezone

import swisseph as swe

AYANAMSAS = {
    # Lahiri matches the astro-seek "Sidereal zodiac" calendar to the minute.
    "lahiri": swe.SIDM_LAHIRI,
    "fagan_bradley": swe.SIDM_FAGAN_BRADLEY,
    "krishnamurti": swe.SIDM_KRISHNAMURTI,
    "raman": swe.SIDM_RAMAN,
}

EPH = swe.FLG_MOSEPH  # built-in Moshier ephemeris; set SE_EPHE_PATH to use .se1 files
if os.environ.get("SE_EPHE_PATH"):
    swe.set_ephe_path(os.environ["SE_EPHE_PATH"])
    EPH = swe.FLG_SWIEPH

STEP = 1 / 24  # one hour scan step (days)
PRECISION = 0.5 / 86400  # half a second


def jd_to_unix(jd):
    return round((jd - 2440587.5) * 86400)


def bisect(f, a, b):
    """Root of f in [a, b], given that the sign of f differs at a and b."""
    fa = f(a)
    while b - a > PRECISION:
        m = (a + b) / 2
        fm = f(m)
        if (fm < 0) == (fa < 0):
            a, fa = m, fm
        else:
            b = m
    return (a + b) / 2


def wrap180(x):
    return (x + 180) % 360 - 180


def moon(jd, flags=0):
    return swe.calc_ut(jd, swe.MOON, EPH | swe.FLG_SPEED | flags)[0]


def sid_lon(jd):
    return moon(jd, swe.FLG_SIDEREAL)[0]


def elongation(jd):
    m = moon(jd)[0]
    s = swe.calc_ut(jd, swe.SUN, EPH)[0][0]
    return (m - s) % 360


def scan(start, end):
    signs, phases, nodes, apsides, decl = [], [], [], [], []
    t = start
    p_sign = int(sid_lon(t) // 30)
    p_elong = elongation(t)
    p_moon = moon(t)
    p_eq = moon(t, swe.FLG_EQUATORIAL)
    while t < end:
        n = t + STEP
        sign = int(sid_lon(n) // 30)
        el = elongation(n)
        mo = moon(n)
        eq = moon(n, swe.FLG_EQUATORIAL)

        if sign != p_sign:
            boundary = (sign * 30) % 360 if (sign - p_sign) % 12 == 1 else p_sign * 30
            r = bisect(lambda x: wrap180(sid_lon(x) - boundary), t, n)
            signs.append([jd_to_unix(r), sign])

        q_prev, q_now = int(p_elong // 90), int(el // 90)
        if q_prev != q_now:
            target = q_now * 90
            r = bisect(lambda x: wrap180(elongation(x) - target), t, n)
            phases.append([jd_to_unix(r), q_now])  # 0 new, 1 first q, 2 full, 3 last q

        if (p_moon[1] < 0) != (mo[1] < 0):  # ecliptic latitude sign change
            r = bisect(lambda x: moon(x)[1], t, n)
            nodes.append([jd_to_unix(r), "asc" if mo[1] > 0 else "desc"])

        if (p_moon[5] < 0) != (mo[5] < 0):  # distance speed sign change
            r = bisect(lambda x: moon(x)[5], t, n)
            apsides.append([jd_to_unix(r), "perigee" if mo[5] > 0 else "apogee", round(moon(r)[2] * 149597870.7)])

        if (p_eq[4] < 0) != (eq[4] < 0):  # declination speed sign change
            r = bisect(lambda x: moon(x, swe.FLG_EQUATORIAL)[4], t, n)
            decl.append([jd_to_unix(r), "min" if eq[4] > 0 else "max", round(moon(r, swe.FLG_EQUATORIAL)[1], 2)])

        t, p_sign, p_elong, p_moon, p_eq = n, sign, el, mo, eq
    return signs, phases, nodes, apsides, decl


def eclipses(start, end):
    out = []
    t = start
    while True:
        res, tret = swe.sol_eclipse_when_glob(t, EPH)
        if tret[0] > end:
            break
        kind = "total" if res & swe.ECL_TOTAL else "annular" if res & swe.ECL_ANNULAR else "partial"
        out.append([jd_to_unix(tret[0]), "solar", kind])
        t = tret[0] + 1
    t = start
    while True:
        res, tret = swe.lun_eclipse_when(t, EPH)
        if tret[0] > end:
            break
        kind = "total" if res & swe.ECL_TOTAL else "partial" if res & swe.ECL_PARTIAL else "penumbral"
        out.append([jd_to_unix(tret[0]), "lunar", kind])
        t = tret[0] + 1
    return sorted(out)


def year_data(year, ayanamsa):
    swe.set_sid_mode(AYANAMSAS[ayanamsa])
    # Pad a few days on each side so periods crossing the year boundary are complete.
    start = swe.julday(year - 1, 12, 25, 0)
    end = swe.julday(year + 1, 1, 7, 0)
    signs, phases, nodes, apsides, decl = scan(start, end)
    return {
        "year": year,
        "zodiac": "sidereal-equal-30",
        "ayanamsa": ayanamsa,
        "ephemeris": "Swiss Ephemeris " + swe.version + (" (Moshier)" if EPH == swe.FLG_MOSEPH else ""),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        # The sign the moon is in at the start of the padded range.
        "initialSign": int(sid_lon(start) // 30),
        "rangeStart": jd_to_unix(start),
        "rangeEnd": jd_to_unix(end),
        "signs": signs,
        "phases": phases,
        "nodes": nodes,
        "apsides": apsides,
        "decl": decl,
        "eclipses": eclipses(start, end),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="y0", type=int, default=datetime.now().year - 1)
    ap.add_argument("--to", dest="y1", type=int, default=datetime.now().year + 5)
    ap.add_argument("--ayanamsa", default="lahiri", choices=AYANAMSAS)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "app", "data"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for y in range(args.y0, args.y1 + 1):
        path = os.path.join(args.out, f"{y}.json")
        with open(path, "w") as f:
            json.dump(year_data(y, args.ayanamsa), f, separators=(",", ":"))
        print("wrote", path)
    index = {"years": list(range(args.y0, args.y1 + 1)), "ayanamsa": args.ayanamsa}
    with open(os.path.join(args.out, "index.json"), "w") as f:
        json.dump(index, f)


if __name__ == "__main__":
    main()
