// Kombi-Version: Grundrisse von oben exakt aus OpenStreetMap, Trakte + Stockwerke aus dem Gebäudeplan der Schulwebseite,
// Innenleben aus den Bauplänen. Koordinaten wie osm-umgebung.js (Meter, x = Osten, z = Süden).
// Zuordnung Trakt -> OSM-Umriss: per Satellitenbild abgeglichen, Trennlinien innerhalb des großen OSM-Umrisses geschätzt.

export const FLOOR_HEIGHT = 4.0; // Schnitt X-X

const A_CROP = {
  UG: { file: "A_UG.jpg", x0: 0.1625, x1: 0.74, y0: 0.29, y1: 0.80 },
  EG: { file: "A_EG.jpg", x0: 0.168, x1: 0.735, y0: 0.31, y1: 0.808 },
  "2OG": { file: "A_2OG.jpg", x0: 0.1625, x1: 0.74, y0: 0.30, y1: 0.806 },
  "3OG": { file: "A_3OG.jpg", x0: 0.1625, x1: 0.74, y0: 0.30, y1: 0.806 },
  "4OG": { file: "A_4OG.jpg", x0: 0.1625, x1: 0.74, y0: 0.30, y1: 0.806 },
};
// Objekte als Anteil im Grundriss-Ausschnitt (u = links->rechts, v = oben->unten)
const uv = (c, fx, fy) => [(fx - c.x0) / (c.x1 - c.x0), (fy - c.y0) / (c.y1 - c.y0)];
const lift = (lvl, source) => { const [u, v] = uv(A_CROP["2OG"], 0.2325, 0.477); return { id: `A-${lvl}-aufzug`, name: "Aufzugsschacht", type: "aufzug", u, v, source }; };
const ug = [
  ["heizung-kessel", "Heizung (Kesselraum)", "heizung", 0.345, 0.696],
  ["heizung-verteilung", "Verteilung Heizung", "heizung", 0.48, 0.72],
  ["niederspannung", "Niederspannung", "elektro", 0.555, 0.655],
  ["trafo-1", "Trafo 1", "elektro", 0.5625, 0.77],
  ["trafo-2", "Trafo 2", "elektro", 0.5975, 0.757],
  ["stadt-ew", "Stadt-EW (Übergabe)", "elektro", 0.6325, 0.753],
  ["abnehmer", "Abnehmer", "elektro", 0.635, 0.646],
].map(([id, name, type, fx, fy]) => { const [u, v] = uv(A_CROP.UG, fx, fy); return { id: `A-UG-${id}`, name, type, u, v, source: "Grundriss UG 1966" }; });

const fl = (...levels) => levels.map((level) => ({ level }));

export const TRAKTE = [
  { id: "A", name: "Trakt A", color: 0xf2d21b, polys: [[[-41,-8.6],[-11.8,-5.5],[-11.8,16.0],[-12.4,16.0],[-12.4,15.6],[-44.1,11.2]]],
    // Grundriss-Rahmen: Mitte, Breite (Achse 0–23), Tiefe (Achse D–A), Drehung. Nordpfeil der Pläne zeigt nach unten -> Plan um ~173° gedreht.
    planFrame: { cx: -27.3, cz: 3.4, w: 31, d: 20, rotYDeg: 173 },
    note: "Grundrisse 1966 diesem Trakt zugeordnet (einziger Trakt mit UG bis 4. OG). Ausrichtung des Plans nach Nordpfeil geschätzt.",
    floors: [
      { level: "UG", plan: A_CROP.UG, objects: [...ug, lift("UG", "Grundriss UG + Schnitt X-X")] },
      { level: "EG", plan: A_CROP.EG, objects: [lift("EG", "Grundriss EG + Schnitt X-X")] },
      { level: "1OG", objects: [lift("1OG", "Schnitt X-X")], note: "Kein Grundriss für das 1. OG vorhanden." },
      { level: "2OG", plan: A_CROP["2OG"], objects: [lift("2OG", "Grundriss 2. OG + Schnitt X-X")] },
      { level: "3OG", plan: A_CROP["3OG"], objects: [lift("3OG", "Grundriss 3. OG + Schnitt X-X")] },
      { level: "4OG", plan: A_CROP["4OG"], objects: [lift("4OG", "Grundriss 4. OG + Schnitt X-X")] },
    ] },
  { id: "B", name: "Trakt B", color: 0xa9a9a9, polys: [[[26,35.8],[27,26.5],[22.8,26.1],[21.7,35.4]]], floors: fl("EG") },
  { id: "C", name: "Trakt C", color: 0x3f5ea8, polys: [[[-11.8,-5.5],[-11.4,-5.5],[-10.6,-18.5],[20.6,-14.3],[16.4,24.0],[-11.8,24.0]],[[-11.8,16.0],[-11.8,24.0],[-13.1,24.0],[-12.4,16.0]]], floors: fl("UG", "EG", "1OG") },
  { id: "E", name: "Trakt E", color: 0xf8bd2c, polys: [[[16.4,24.0],[14.5,41.4],[22.0,41.8],[22.0,58.8],[16.1,58.4],[14.4,65],[-11.9,61.2],[-9.9,46.2],[-15.2,46],[-13.2,24.0]]], floors: fl("UG", "EG"),
    note: "Für das UG existiert eine DWG-Datei (24-01_UG_E.dwg), hier noch nicht eingelesen." },
  { id: "F", name: "Trakt F", color: 0x8e3b8f, polys: [[[22.0,41.8],[31.6,42.4],[33.5,21.3],[24.4,9.5],[25.3,-7.2],[30,-6.8],[29.6,-10.6],[26.7,-11],[28.3,-28.6],[32.5,-28.6],[36.7,-28.5],[36.7,-28.6],[44.5,-28.6],[44.4,-28],[49.8,-27.8],[48.2,3.9],[58.4,12.4],[58.2,30.1],[51.5,34.8],[50.6,46.4],[57.8,47.8],[56.4,61.4],[22.0,58.8]]], floors: fl("EG") },
  { id: "H", name: "Trakt H", color: 0x6aaf3a, polys: [[[-26.1,-115.9],[19.6,-110.9],[15.4,-72.1],[1.4,-73.6],[-30.3,-77]]], floors: fl("UG", "EG", "1OG") },
  { id: "I", name: "Trakt I", color: 0xf0931f, polys: [[[15.4,-72.1],[28.5,-70.6],[20.6,-14.3],[-10.6,-18.5],[-5.4,-62.1],[0.4,-62.2],[1.4,-73.6]]], floors: fl("EG") },
  { id: "K", name: "Trakt K", color: 0xdc1f3c, polys: [[[28.3,-28.6],[28.3,-28.7],[32.5,-28.6],[36.7,-28.6],[37.9,-35.4],[32,-36.1],[34.7,-64.6],[47.9,-62.9],[44.5,-28.6]]], floors: fl("EG") },
  { id: "L", name: "Trakt L", color: 0x98cbd2, polys: [[[-55,-101.4],[-58.1,-72.2],[-51.6,-71.5],[-52.1,-66.9],[-41.7,-65.8],[-38.1,-99.6]]], floors: fl("EG", "1OG") },
  { id: "N1", name: "Nebengebäude", color: 0xbfbfbf, polys: [[[38.7,-75.4],[42.2,-75],[41.5,-68.2],[37.9,-68.6]]], floors: fl("EG"), note: "In OpenStreetMap ohne Namen; im Gebäudeplan keinem Trakt zuzuordnen." },
];

// Trakte aus dem Gebäudeplan, die in den Kartendaten nicht vorkommen -> nicht gezeichnet, damit die Draufsicht der Karte entspricht
export const NOT_IN_MAP = ["D", "G"];
