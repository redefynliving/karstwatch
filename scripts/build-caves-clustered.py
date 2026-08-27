#!/usr/bin/env python3
"""Build the cave entrances clustered GeoJSON from IGS sinkhole inventory + OSM cave data."""

import json, math, random, sys, urllib.request, urllib.parse
from pathlib import Path

WORK = Path("/Users/alijahfox/karstwatch/public/static/geo")
WORK.mkdir(parents=True, exist_ok=True)

IGWS_URL = "https://portal.igs.indiana.edu/arcgis/rest/services/Karst_Sinkhole_Inventory_IN_KY_2011/MapServer/118/query"
OSM_URL = "https://overpass-api.de/api/interpreter"
OSM_BBOX = "-86.7,39.05,-86.4,39.3"

def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlng/2)**2)
    return 2 * R * math.asin(math.sqrt(a))

def kmeans(points, k, max_iter=50):
    if len(points) <= k:
        return [(p, 1, [p[:2]]) for p in points]
    centers = random.sample(points, k)
    clusters = []
    for _ in range(max_iter):
        clusters = [[] for _ in range(k)]
        for p in points:
            best = 0; bestDist = haversine(p[0], p[1], centers[0][0], centers[0][1])
            for i, c in enumerate(centers[1:], 1):
                d = haversine(p[0], p[1], c[0], c[1])
                if d < bestDist: best = i; bestDist = d
            clusters[best].append(p)
        new = []
        for cl in clusters:
            if not cl: new.append(random.choice(points))
            else:
                al = sum(c[0] for c in cl)/len(cl); alng = sum(c[1] for c in cl)/len(cl)
                new.append([alng, al])
        if all(haversine(n[1], n[0], c[1], c[0]) < 0.001 for n, c in zip(new, centers)): break
        centers = new
    result = []
    for cl in clusters:
        if not cl: continue
        al = sum(c[0] for c in cl)/len(cl); alng = sum(c[1] for c in cl)/len(cl)
        max_d = max(haversine(m[1], m[0], alng, al) for m in cl)
        result.append(([alng, al], len(cl), cl))
    return sorted(result, key=lambda x: -x[1])

def fetch_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "KarstWatch/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())

def fetch_igws():
    print("Fetching IGWS sinkhole inventory...")
    url = f"{IGWS_URL}?f=json&where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=2000"
    all_features = []
    attempt = 0
    while True:
        offset = len(all_features)
        req_url = url + f"&resultOffset={offset}"
        try:
            data = fetch_json(req_url, timeout=60)
        except Exception as e:
            print(f"  IGWS fetch failed (offset={offset}): {e}")
            return []
        feats = data.get("features", [])
        if not feats: break
        all_features.extend(feats)
        print(f"  Fetched {len(feats)} (total: {len(all_features)})")
        if len(feats) < 2000: break
        attempt += 1
        if attempt > 200:
            print("  Warning: exceeded 200 pages"); break
    bbox = [-86.7, 39.05, -86.4, 39.3]
    points = []
    for f in all_features:
        g = f.get("geometry", {})
        x, y = g.get("x"), g.get("y")
        if x is None or y is None: continue
        if bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]:
            points.append([y, x])
    print(f"  Monroe County sinkholes: {len(points)}")
    return points

def fetch_osm():
    print("Querying Overpass API for cave:entrance nodes...")
    query = f'[out:json][timeout:60]; node["cave:entrance"]({OSM_BBOX}); out center;'
    body = urllib.parse.urlencode({"data": query}).encode()
    try:
        req = urllib.request.Request(OSM_URL, data=body, headers={"User-Agent": "KarstWatch/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
        elements = data.get("elements", [])
        points = [[el["lat"], el["lon"]] for el in elements if el.get("type") == "node"]
        print(f"  OSM cave:entrance nodes: {len(points)}")
        return points
    except Exception as e:
        print(f"  OSM fetch failed: {e}")
        return []

def main():
    igws_pts = fetch_igws()
    osm_pts = fetch_osm()
    all_pts = igws_pts + osm_pts
    if not all_pts:
        print("No cave/sinkhole points — skipping.")
        sys.exit(0)
    print(f"Total points to cluster: {len(all_pts)}")
    k = min(50, len(all_pts))
    clusters = kmeans(all_pts, k)
    features = []
    for center, count, members in clusters:
        lng, lat = center[0], center[1]
        radius_m = max(haversine(m[1], m[0], lng, lat) for m in members)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": {"count": count, "radius_m": round(radius_m, 1),
                           "source": "igws" if any(m in igws_pts for m in members) else "osm"},
        })
    fc = {"type": "FeatureCollection", "features": features}
    out_path = WORK / "caves-clustered.geojson"
    with open(out_path, "w") as f:
        json.dump(fc, f)
    print(f"Wrote {len(features)} clusters to {out_path}")
    print(f"File size: {len(json.dumps(fc))/1024:.0f}KB")

if __name__ == "__main__":
    main()