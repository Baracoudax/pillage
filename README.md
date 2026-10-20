# PILLAGE — nuit d'émeutes

Extraction shooter **FPS** 3D jouable dans le navigateur (PC, mobile, tablette), en **solo** et en **multijoueur**.
Tu pilles des magasins pendant une nuit d'émeutes. Tu évites les émeutiers qui veulent ton butin et les CRS
qui veulent t'interpeller, tu rejoins une sortie, puis tu revends le butin au receleur pour acheter du
meilleur équipement et débloquer des quartiers plus riches.

## Lancer le jeu

```bash
npm install
npm run build      # compile le client dans dist/
npm start          # serveur : http://localhost:8080 (jeu + multijoueur)
```

Développement avec rechargement à chaud : `npm run dev:server` dans un terminal, `npm run dev` dans un
autre, puis ouvrir http://localhost:5173.
`npm test` lance une simulation sans affichage (un bot pille et s'extrait) pour vérifier la logique.

Le **solo fonctionne hors ligne** : la simulation tourne dans le navigateur. On peut donc héberger
`dist/` sur n'importe quel hébergement statique (itch.io, GitHub Pages…). Le multijoueur a besoin du
serveur Node (`npm start`), à héberger par exemple sur un VPS, Fly.io ou Render. Pour un client statique
qui se connecte à un serveur distant : `https://mon-jeu/?server=https://mon-serveur`.

## Gameplay

| | |
|---|---|
| **Raid** | 8 à 10 min. On apparaît dans le quartier, on pille, on rejoint l'une des 3 sorties (la 3e ouvre plus tard). Rester 6 s dans la zone verte. |
| **Loot** | Objets en rayon (couleur = rareté) et caisses enregistreuses, plus longues à vider. Chaque objet a un poids : le sac limite ce qu'on emporte. |
| **Armes (FPS)** | Pistolets (Makarov, Luger, lance-fusées), PM (Grease Gun, Suomi), fusil à pompe, AK-47, M4A1, fusil de précision à lunette. Visée (clic droit), recul, rechargement, tirs à la tête. Grenades : fumigène (bloque la vue des CRS), aveuglante, à fragmentation, cocktail Molotov, mine Claymore. **Chaque coup de feu s'entend et attire les CRS.** |
| **Gilets jaunes** | Des cortèges défilent de carrefour en carrefour et se rassemblent au rond-point occupé (cercle jaune sur la minimap). Au milieu d'un cortège, la distance de détection des CRS est fortement réduite ; avec la tenue « Gilet jaune », tu deviens presque invisible. Si tu leur tires dessus, le cortège se retourne contre toi. Les CRS gazent parfois les cortèges, qui se dispersent. |
| **Émeutiers** | Cagoulés façon black bloc. Ils errent, pillent aussi et lancent des pavés ou des cocktails Molotov sur les CRS. La tenue « Cagoule » les rend beaucoup moins agressifs envers toi. Si tu portes du butin, certains t'attaquent et **volent l'objet le plus cher** puis s'enfuient : mets-les K.O. pour le récupérer. |
| **CRS** | Patrouilles de 3 (casque, visière, épaulières, bouclier, LBD) qui convergent vers les magasins récemment pillés et vers les coups de feu. Vue en cône, ligne de vue réelle. **Le bouclier arrête les balles de face** : il faut viser la tête ou les prendre de flanc. Tirs de LBD (étourdissement), grenades lacrymogènes et de désencerclement, matraque. Être mis à terre par eux = **interpellation** (butin saisi et amende de 10 %). |
| **Tension** | Monte avec le temps, le pillage et les attaques contre les CRS. Plus elle est haute, plus il y a de renforts. |
| **Discrétion** | S'accroupir réduit fortement la distance de détection. Le sprint consomme de l'endurance. |
| **Échec** | K.O., interpellation ou fin du temps : le butin et les consommables emportés sont perdus et le butin reste au sol dans un sac que d'autres joueurs peuvent ramasser. L'équipement acheté est conservé. |
| **Multijoueur** | Jusqu'à 8 joueurs par salon, PvP activé. Code à 4 lettres ou liste des parties publiques, avec arrivée en cours de raid. |

**Progression** : le receleur rachète le butin. Au marché noir : armes, munitions, grenades, sacs (8 → 42 kg),
tenues (cagoule, gilet jaune), protections, chaussures (vitesse), masque à gaz et bandages. On démarre avec un
Makarov. Les quartiers (La Cité → Centre-ville 6 000 € → Triangle d'Or 30 000 €)
donnent accès à de nouveaux magasins (Hi-Fi, bijouteries, luxe), à du loot plus rare et à plus de CRS.

### Contrôles
- **PC** : ZQSD/WASD pour bouger, souris pour viser, clic gauche pour tirer, clic droit pour viser à la mire
  ou à la lunette, R pour recharger, 1/2 ou la molette pour changer d'arme, G pour lancer, T pour choisir la
  grenade, V pour un coup de crosse, **E maintenu** pour piller, Maj pour sprinter, C pour s'accroupir, H pour
  un bandage, Tab pour le sac et Échap pour la pause.
- **Mobile** : joystick à gauche, glisser à droite pour viser, boutons tir, visée, rechargement, arme,
  grenade, etc. Visée légèrement assistée.

## Architecture

```
shared/   code commun client + serveur
  config.js   constantes, quartiers, types de magasins
  items.js    loot, équipement, consommables, validation du loadout
  map.js      génération procédurale déterministe (seed), collisions, ligne de vue, A*
  world.js    simulation autoritaire d'un raid (IA, combat, loot, extraction, snapshots)
server/server.js   HTTP statique + WebSocket /ws, un World par salon à 20 Hz
client/src/
  main.js     menus (planque, marché noir, quartiers, multi) et boucle principale
  raid.js     prédiction locale, interpolation, caméra, interactions, HUD et minimap
  cityView.js géométrie statique de la ville (fusionnée)
  chars.js    personnages instanciés (émeutiers cagoulés, CRS, gilets jaunes)
  viewmodel.js arme en main à la 1re personne (scène dédiée, recul, visée, rechargement)
  assets.js   chargement des .glb (meshopt + WebP)
  fx.js       particules, projectiles et lumières
  gfx.js      renderer, presets de qualité et résolution dynamique
  net.js      LocalTransport (solo) / NetTransport (WebSocket), même interface
  input.js, audio.js, profile.js
```

Le **même code de simulation** (`shared/world.js`) tourne dans le navigateur en solo et sur le serveur en
multi. Le client ne fait que prédire son propre déplacement (avec les mêmes collisions) et afficher.
La carte est régénérée à l'identique des deux côtés à partir de la seed : elle n'est jamais envoyée sur le
réseau.

## Optimisations (pour tourner sur un maximum d'appareils)

- **≈ 15 à 30 draw calls** pour toute la scène : la ville est fusionnée par matériau (immeubles, murs,
  rayons, voitures, enseignes via un atlas de texte) et tout le loot tient dans un `InstancedMesh`.
- **Personnages instanciés** : chaque membre (jambes, bras, tête, casque, bouclier…) est un `InstancedMesh`
  partagé. Le coût reste constant, qu'il y ait 10 ou 150 personnages.
- **Particules** (feu, fumée, lacrymo, explosions) dans 2 `Points` avec un shader maison.
- **Lumières** : pool fixe de 0, 2 ou 4 `PointLight` réassignées aux feux les plus proches. Le nombre reste
  constant, donc les shaders ne sont pas recompilés. Les halos au sol sont des décalques additifs, pas de
  vraies lumières.
- **Textures procédurales** (façades, enseignes) générées au lancement : aucun téléchargement d'image.
  Le bundle complet fait **~160 ko gzip**.
- **Qualité auto** (Bas/Moyen/Haut) selon l'appareil (mobile, cœurs, RAM, GPU), plus une **résolution
  dynamique** qui ajuste le pixel ratio pour viser 55–60 FPS. Le brouillard limite la distance d'affichage
  et les personnages lointains sont ignorés.
- **Serveur** : pathfinding A* sur grille avec budget par tick, PNJ éloignés de tous les joueurs mis à jour
  4× moins souvent, moins de 1,5 ms par tick pour 30 à 45 PNJ (mesuré par `npm test`). **Réseau** : snapshots à 10 Hz filtrés
  par distance (zone d'intérêt de 90 m, ~0,5 ko), projectiles simulés côté client à partir de leur
  vitesse initiale, et snapshots sautés si un client n'arrive plus à suivre.
- Les shaders sont précompilés pendant l'écran de chargement. Les sons sont synthétisés en WebAudio
  (0 fichier audio).

## Assets 3D

**Armes et explosifs** : [Free CC0 Guns & Explosives Pack](https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack)
de 3dmodelscc0 (licence CC0), dans sa conversion GLB publiée par BoQsc
([GitHub](https://github.com/BoQsc/cc0-guns-explosives-pack-glb)). Fichiers optimisés dans
`client/public/models/weapons/` : **170 Mo → 3 Mo** (textures 1024 px pour les armes, 512 px pour les grenades,
en WebP, géométrie compressée meshopt). Seuls les modèles équipés sont chargés.

Pour (ré)optimiser des modèles : `node tools/optimize-assets.mjs <dossier_source> <dossier_sortie> Nom=1024 ...`.
`tools/inspect-glb.mjs` et `tools/list-nodes.mjs` permettent d'inspecter un fichier, et `npm run dev` puis
`/dev/viewer.html` affiche une planche de vignettes.

## Intégration des autres assets

Le prototype utilise des formes géométriques provisoires. Pour brancher de vrais assets, le format idéal :

- **Format** `.glb` (glTF binaire), Y vers le haut, 1 unité = 1 mètre, personnages orientés vers +Z.
- **Personnages** (joueur, émeutier, CRS) : un mesh riggé avec les animations `idle`, `walk`, `run`,
  `crouch`, `attack`, `throw`, `hit`, `ko`. 2 000 à 5 000 triangles et une seule texture si possible.
- **Décors** : immeubles modulaires, devantures ou intérieurs de magasins, voitures (intacte et brûlée),
  poubelles, barricades, lampadaires, fourgon CRS.
- **Objets de loot** : petits modèles ou icônes (téléphone, TV, baskets, montre…).
- **Textures** : 512–1024 px max, en atlas si possible. Je les convertirai en KTX2/Basis et compresserai
  les meshes (meshopt) pour le mobile.

À l'intégration, le rendu instancié actuel des personnages restera comme **LOD lointain** et les modèles
animés seront utilisés de près.
