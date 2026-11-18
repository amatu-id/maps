# Amatu Maps

Peta, pencarian, rute & navigasi gaya Google Maps untuk Portal AMATU — https://amatu-id.github.io/maps/

- Peta vektor OpenFreeMap (© OpenMapTiles © OpenStreetMap), mode siang/malam, satelit (Esri), medan (AWS Terrain Tiles).
- Rute & navigasi: Valhalla (FOSSGIS, valhalla1.openstreetmap.de). Default mobil; motor otomatis tanpa jalan tol.
- Pencarian: Photon (Komoot); tempat sekitar dibaca langsung dari tile peta; Overpass lewat fungsi `amatu-osm`.
- SPBU di sepanjang rute: `data/poi/` dibangun mingguan oleh GitHub Action dari ekstrak Geofabrik (OSM, ODbL).
- Estimasi BBM mobil/motor (km/L) + harga Bensin/Solar yang bisa diubah.

Build: `./build.sh` → `index.html` (`?v=<hash>`) + `versi.txt`.
