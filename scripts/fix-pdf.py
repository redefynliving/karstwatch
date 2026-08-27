import re

with open('components/MapView.tsx', 'r') as f:
    content = f.read()

# 1. Update table header
old_header = '<tr><th>#</th><th>Depth (m)</th><th>Area (acres)</th><th>Center (lat, lng)</th></tr>'
new_header = '<tr><th>#</th><th>Depth (m)</th><th>Area (acres)</th><th>Confidence</th><th>Circularity</th><th>Center (lat, lng)</th></tr>'
content = content.replace(old_header, new_header)

# 2. Update table rows to include confidence + circularity
old_row = '<tr><td>${i+1}</td><td>${d.depthM.toFixed(1)}</td><td>${(d.areaM2/4046.86).toFixed(2)}</td><td>${d.centroid[1].toFixed(5)}, ${d.centroid[0].toFixed(5)}</td></tr>'
new_row = '<tr><td>${i+1}</td><td>${d.depthM.toFixed(1)}</td><td>${(d.areaM2/4046.86).toFixed(2)}</td><td>${d.confidence}</td><td>${d.circularity.toFixed(2)}</td><td>${d.centroid[1].toFixed(5)}, ${d.centroid[0].toFixed(5)}</td></tr>'

if old_row in content:
    content = content.replace(old_row, new_row)
    print("OK: updated both header and rows")
else:
    print("WARN: row template not found")

# 3. Add a confidence summary to the PDF
old_summary = '<p>Total dips detected: <b>${results?.length ?? 1}</b></p>'
new_summary = '''<p>Total dips detected: <b>${results?.length ?? 1}</b></p>
  <p>Likely sinkholes: <b>${results?.filter(r => r.confidence === "likely").length ?? 0}</b> · Uncertain: <b>${results?.filter(r => r.confidence === "uncertain").length ?? 0}</b> · Natural depressions: <b>${results?.filter(r => r.confidence === "low").length ?? 0}</b></p>'''
content = content.replace(old_summary, new_summary)

with open('components/MapView.tsx', 'w') as f:
    f.write(content)

print("Done")
