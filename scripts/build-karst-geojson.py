#!/usr/bin/env python3
"""Build bedrock karst GeoJSON: limestone + dolomite, simplified, public/."""

import json
import math

def perpendicular_distance(point, start, end):
    if start == end:
        return math.sqrt((point[0]-start[0])**2 + (point[1]-start[1])**2)
    a = end[1] - start[1]
    b = start[0] - end[0]
    c = end[0]*start[1] - start[0]*end[1]
    return abs(a*point[0] + b*point[1] + c) / math.sqrt(a**2 + b**2)

def douglas_peucker(points, epsilon):
    if len(points) <= 2:
        return points
    max_dist = 0
    max_idx = 0
    for i in range(1, len(points) - 1):
        dist = perpendicular_distance(points[i], points[0], points[-1])
        if dist > max_dist:
            max_dist = dist
            max_idx = i
    if max_dist > epsilon:
        left = douglas_peucker(points[:max_idx + 1], epsilon)
        right = douglas_peucker(points[max_idx:], epsilon)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]

def simplify_ring(ring, epsilon):
    if len(ring) <= 2:
        return ring
    simplified = douglas_peucker(ring[:-1], epsilon)
    simplified.append(simplified[0])
    return simplified

# Load full bedrock data
data = json.load(open('/tmp/bedrock_full.json'))

karst_features = []
for feat in data['features']:
    lith = feat.get('properties', {}).get('Lithology', '').lower()
    if lith in ('limestone', 'dolomite'):
        props = {
            'lithology': feat['properties'].get('Lithology', ''),
            'name': feat['properties'].get('Name', ''),
            'unit': feat['properties'].get('Unit', ''),
            'ages': feat['properties'].get('Ages', ''),
            'formations': feat['properties'].get('Formations', ''),
        }
        geom = feat['geometry']
        # Keep only exterior rings, simplify at ~1km tolerance
        EPS = 0.02
        if geom['type'] == 'Polygon':
            geom['coordinates'] = [simplify_ring(geom['coordinates'][0], EPS)]
        elif geom['type'] == 'MultiPolygon':
            new_polys = []
            for poly in geom['coordinates']:
                new_polys.append([simplify_ring(poly[0], EPS)])
            geom['coordinates'] = new_polys
        karst_features.append({
            'type': 'Feature',
            'geometry': geom,
            'properties': props,
        })

out = {'type': 'FeatureCollection', 'features': karst_features}
out_path = 'public/static/geo/bedrock-karst.geojson'

with open(out_path, 'w') as f:
    json.dump(out, f, separators=(',', ':'))

# Also write a rounded version for smaller size
def round_coords(geom, decimals=4):
    """Round all coordinates to specified decimals."""
    if geom['type'] == 'Polygon':
        geom['coordinates'] = [[[round(c, decimals) for c in coord] for coord in ring] for ring in geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        for poly in geom['coordinates']:
            for ring in poly:
                for i, coord in enumerate(ring):
                    ring[i] = [round(c, decimals) for c in coord]
    return geom

for feat in karst_features:
    feat['geometry'] = round_coords(feat['geometry'], 4)

with open(out_path, 'w') as f:
    json.dump(out, f, separators=(',', ':'))

import os
size = os.path.getsize(out_path)
total_coords = 0
for feat in karst_features:
    g = feat['geometry']
    if g['type'] == 'Polygon':
        total_coords += len(g['coordinates'][0])
    elif g['type'] == 'MultiPolygon':
        total_coords += sum(len(p[0]) for p in g['coordinates'])

print(f'Wrote {len(karst_features)} limestone/dolomite polygons to {out_path}')
print(f'Size: {size/1024:.0f}KB')
print(f'Total coords: {total_coords}')
