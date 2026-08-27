import re

with open('components/MapView.tsx', 'r') as f:
    content = f.read()

# Replace the Center dt/dd line with Confidence + Circularity + Center
old = '<dt className="font-medium text-kw-muted">Center</dt><dd className="font-mono">{((( selected.bounds[0][1]+selected.bounds[1][1])/2)).toFixed(5)}, {(((selected.bounds[0][0]+selected.bounds[1][0])/2)).toFixed(5)}</dd>'

new = '''<dt className="font-medium text-kw-muted">Confidence</dt><dd className="font-semibold">
                {selected.confidence === "likely" && <span className="text-green-700">Sinkhole likely</span>}
                {selected.confidence === "uncertain" && <span className="text-amber-700">Uncertain - needs field check</span>}
                {selected.confidence === "low" && <span className="text-kw-muted">Natural depression</span>}
              </dd>
              <dt className="font-medium text-kw-muted">Circularity</dt><dd className="font-mono">{selected.circularity.toFixed(2)} (1.0 = perfect circle)</dd>
              <dt className="font-medium text-kw-muted">Center</dt><dd className="font-mono">{((( selected.bounds[0][1]+selected.bounds[1][1])/2)).toFixed(5)}, {(((selected.bounds[0][0]+selected.bounds[1][0])/2)).toFixed(5)}</dd>'''

if old in content:
    content = content.replace(old, new)
    with open('components/MapView.tsx', 'w') as f:
        f.write(content)
    print("OK: replaced Center fields with Confidence/Circularity/Center")
else:
    print("WARN: old string not found — checking what's actually there")
    idx = content.find("Center")
    if idx >= 0:
        print(repr(content[idx-50:idx+200]))
