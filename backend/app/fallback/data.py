"""Jeux de données de démonstration réalistes pour Dijon (utilisés quand une source est indisponible).

Les coordonnées sont approximatives ; les horaires sont générés relativement à l'heure courante.
"""

# --- Stations Vélodi (positions approximatives) : id, nom, lat, lon, capacité
VELODI_STATIONS = [
    ("1", "Gare Dijon-Ville", 47.3233, 5.0283, 20),
    ("2", "Voltaire - Mirande", 47.3170, 5.0560, 16),
    ("3", "Place Darcy", 47.3223, 5.0352, 20),
    ("4", "Place de la Libération", 47.3216, 5.0412, 18),
    ("5", "République", 47.3271, 5.0457, 16),
    ("6", "Godrans", 47.3245, 5.0405, 14),
    ("7", "Wilson", 47.3150, 5.0450, 18),
    ("8", "Grangier", 47.3242, 5.0383, 16),
    ("9", "Saint-Bénigne", 47.3218, 5.0362, 12),
    ("10", "Jean Macé", 47.3262, 5.0320, 14),
    ("11", "Monge", 47.3170, 5.0350, 14),
    ("12", "Port du Canal", 47.3150, 5.0270, 12),
    ("13", "Auditorium", 47.3290, 5.0500, 16),
    ("14", "Toison d'Or", 47.3420, 5.0500, 24),
    ("15", "Université - Érasme", 47.3105, 5.0670, 22),
    ("16", "Cours du Parc - Piscine", 47.3100, 5.0490, 14),
    ("17", "Jardin de l'Arquebuse", 47.3200, 5.0250, 14),
    ("18", "Mazen - Sully", 47.3210, 5.0620, 14),
    ("19", "Bourroches", 47.3080, 5.0280, 12),
    ("20", "Parc des Expositions", 47.3290, 5.0560, 16),
]

# --- Points de rendez-vous / gares (carte)
MEETING_POINTS = [
    ("gare", "train", "Gare de Dijon-Ville", 47.3233, 5.0272, "Gare SNCF · TGV, TER, OUIGO"),
    ("gare-routiere", "coach", "Gare routière de Dijon", 47.3226, 5.0290, "FlixBus · BlaBlaCar Bus · cars régionaux"),
    ("bbc-darcy", "carpool", "RDV covoiturage — Place Darcy", 47.3223, 5.0347, "Point de rendez-vous BlaBlaCar"),
    ("bbc-arquebuse", "carpool", "RDV covoiturage — Rue de l'Arquebuse", 47.3196, 5.0254, "Point de rendez-vous BlaBlaCar"),
]

# --- Modèles d'horaires trains (minute dans l'heure, période en minutes)
# operator, numéro de base, destination, via, provenance (arrivées), voie, minute, période
TRAIN_TEMPLATES = [
    ("TGV INOUI", 6700, "Paris Gare de Lyon", "Direct", "Paris Gare de Lyon", "A", 7, 120),
    ("TER Mobigo", 891200, "Lyon Part-Dieu", "Beaune · Chalon-sur-Saône · Mâcon", "Lyon Part-Dieu", "D", 12, 60),
    ("TER Mobigo", 894100, "Besançon Viotte", "Auxonne · Dole-Ville", "Besançon Viotte", "C", 22, 60),
    ("OUIGO", 7630, "Marseille Saint-Charles", "Lyon Part-Dieu · Avignon", "Paris Bercy", "B", 34, 240),
    ("TER Mobigo", 896000, "Nevers", "Montchanin · Le Creusot", "Nevers", "F", 41, 120),
    ("TGV Lyria", 9270, "Lausanne", "Frasne · Vallorbe", "Paris Gare de Lyon", "G", 48, 240),
    ("TER Mobigo", 893300, "Is-sur-Tille", "Direct", "Is-sur-Tille", "E", 53, 120),
    ("TGV INOUI", 6800, "Strasbourg", "Besançon Franche-Comté TGV · Mulhouse", "Lyon Part-Dieu", "B", 27, 180),
]

# Parcours des trains de démonstration (même ordre que TRAIN_TEMPLATES) :
# (gare, minutes par rapport au passage à Dijon). Offsets négatifs = gares avant Dijon (train traversant).
# Pour un train qui part de Dijon, le parcours des arrivées est le trajet inverse.
TRAIN_ROUTES = [
    [("Dijon-Ville", 0), ("Montbard", 36), ("Paris Gare de Lyon", 97)],
    [("Dijon-Ville", 0), ("Nuits-Saint-Georges", 14), ("Beaune", 23), ("Chagny", 33), ("Chalon-sur-Saône", 43),
     ("Tournus", 60), ("Mâcon-Ville", 78), ("Villefranche-sur-Saône", 102), ("Lyon Part-Dieu", 122)],
    [("Dijon-Ville", 0), ("Genlis", 13), ("Auxonne", 22), ("Dole-Ville", 34), ("Besançon Viotte", 68)],
    [("Paris Bercy", -108), ("Dijon-Ville", 0), ("Lyon Part-Dieu", 103), ("Avignon TGV", 168), ("Aix-en-Provence TGV", 191),
     ("Marseille Saint-Charles", 206)],
    [("Dijon-Ville", 0), ("Beaune", 22), ("Chagny", 32), ("Montchanin", 58), ("Le Creusot Ville", 67), ("Nevers", 146)],
    [("Paris Gare de Lyon", -97), ("Dijon-Ville", 0), ("Dole-Ville", 29), ("Frasne", 76), ("Vallorbe", 96), ("Lausanne", 132)],
    [("Dijon-Ville", 0), ("Ruffey", 8), ("Gemeaux", 18), ("Is-sur-Tille", 25)],
    [("Lyon Part-Dieu", -104), ("Mâcon-Ville", -66), ("Dijon-Ville", 0), ("Besançon Franche-Comté TGV", 29),
     ("Belfort-Montbéliard TGV", 54), ("Mulhouse-Ville", 79), ("Strasbourg", 122)],
]

# operator, numéro, destination, via, provenance, quai, minute, période, mode
COACH_TEMPLATES = [
    ("FlixBus", "N° 1712", "Lyon Perrache", "Mâcon", "Paris Bercy", "Q3", 5, 180, "flixbus"),
    ("FlixBus", "N° 1709", "Strasbourg", "Besançon · Mulhouse", "Lyon Perrache", "Q2", 40, 240, "flixbus"),
    ("BlaBlaCar Bus", "N° 3409", "Paris Bercy", "Auxerre", "Genève", "Q5", 18, 240, "blablacar"),
    ("BlaBlaCar Bus", "N° 3410", "Genève", "Bourg-en-Bresse", "Paris Bercy", "Q4", 50, 300, "blablacar"),
    ("Covoiturage", "3 places", "Strasbourg", "RDV Place Darcy", "Strasbourg", "Darcy", 20, 180, "blablacar"),
    ("Covoiturage", "2 places", "Besançon", "RDV Rue de l'Arquebuse", "Besançon", "Arquebuse", 45, 150, "blablacar"),
]

# Parcours des cars (même ordre que COACH_TEMPLATES) : (arrêt, minutes par rapport à Dijon) ; None = covoiturage
COACH_ROUTES = [
    [("Paris Bercy", -200), ("Dijon — Gare routière", 0), ("Mâcon", 95), ("Lyon Perrache", 150)],
    [("Lyon Perrache", -150), ("Dijon — Gare routière", 0), ("Besançon", 75), ("Mulhouse", 175), ("Strasbourg", 245)],
    [("Genève", -210), ("Dijon — Gare routière", 0), ("Auxerre", 110), ("Paris Bercy", 215)],
    [("Paris Bercy", -215), ("Dijon — Gare routière", 0), ("Bourg-en-Bresse", 120), ("Genève", 210)],
    None,
    None,
]

# --- Tracés de secours des trams (lon, lat) si le GTFS statique n'est pas chargé
TRAM_FALLBACK_SHAPES = {
    "T1": [[5.0272, 47.3233], [5.0347, 47.3223], [5.0405, 47.3245], [5.0457, 47.3271], [5.0560, 47.3260],
           [5.0700, 47.3240], [5.0850, 47.3230], [5.0980, 47.3215]],
    "T2": [[5.0500, 47.3560], [5.0480, 47.3420], [5.0457, 47.3271], [5.0405, 47.3245], [5.0360, 47.3180],
           [5.0320, 47.3080], [5.0230, 47.2950], [5.0140, 47.2880]],
}

# --- Actualités de secours
NEWS = [
    ("Le Bien Public", "Centre-ville : la rue de la Liberté partiellement fermée pour travaux cette semaine",
     "Les interventions sur les réseaux souterrains entraînent une déviation des piétons et des livraisons."),
    ("ici Bourgogne", "Premières gelées attendues ce week-end en Côte-d'Or",
     "Les températures pourraient descendre sous zéro dans la nuit de samedi à dimanche."),
    ("Ville de Dijon", "Collecte des déchets : horaires modifiés pendant les fêtes",
     "Le calendrier de collecte évolue les jours fériés de fin d'année."),
    ("Le Bien Public", "Basket : la JDA Dijon s'impose à domicile",
     "Les Dijonnais ont fait la différence dans le dernier quart-temps."),
    ("Ville de Dijon", "Nouvelles stations Vélodi : la consultation est ouverte",
     "Les habitants peuvent proposer des emplacements pour les prochaines stations."),
    ("ici Bourgogne", "La saison culturelle d'hiver dévoilée à Dijon",
     "Concerts, expositions et spectacles jeune public au programme jusqu'en mars."),
]

SOCIAL = [
    ("@DiviaMobilites", "Tram T2 : trafic ralenti entre Godrans et Monge, retards de 5 à 10 min.", "Mastodon"),
    ("@VilledeDijon", "Les illuminations de fin d'année s'allument vendredi à 18 h, place de la Libération.", "RSS"),
    ("@DiviaMobilites", "Ce week-end, service de soirée renforcé sur T1 et T2.", "Mastodon"),
    ("@VilledeDijon", "Le marché des Halles est ouvert exceptionnellement dimanche matin.", "RSS"),
]

# --- Événements de secours : jours à partir d'aujourd'hui, heure, titre, catégorie, lieu, prix
EVENTS = [
    (1, "20:30", "Concert rock", "concert", "La Vapeur", "18 €"),
    (2, "18:00", "DFCO — match de championnat", "sport", "Stade Gaston-Gérard", "dès 10 €"),
    (3, "15:00", "Visite guidée des collections", "expo", "Musée des Beaux-Arts", "Gratuit"),
    (3, "10:30", "Atelier jeune public", "famille", "Musée des Beaux-Arts", "5 €"),
    (6, "20:00", "Scène découverte", "concert", "La Vapeur", "8 €"),
    (9, "20:00", "Grand spectacle", "spectacle", "Zénith de Dijon", "dès 39 €"),
    (12, "20:00", "Opéra — soirée lyrique", "spectacle", "Auditorium de Dijon", "dès 15 €"),
    (16, "19:30", "DFCO — match de championnat", "sport", "Stade Gaston-Gérard", "dès 10 €"),
    (23, "20:00", "Tournée d'hiver", "concert", "Zénith de Dijon", "dès 45 €"),
]

# Salles et lieux : mot-clé dans le nom du lieu -> (nom affiché, lat, lon, type, libellé court).
# Positions OpenStreetMap (Nominatim). Type : salle (musique/spectacle), sport, expo.
VENUE_POSITIONS = [
    ("gaston", "Stade Gaston-Gérard", 47.32438, 5.06833, "sport", "Stade"),
    ("zénith", "Zénith de Dijon", 47.35662, 5.05670, "salle", "Zénith"),
    ("zenith", "Zénith de Dijon", 47.35662, 5.05670, "salle", "Zénith"),
    ("vapeur", "La Vapeur", 47.34634, 5.05943, "salle", "Vapeur"),
    ("auditorium", "Auditorium de Dijon", 47.32841, 5.05219, "salle", "Auditorium"),
    ("palais des sports", "Palais des sports", 47.33236, 5.05594, "sport", "Palais des sports"),
    ("expositions", "Parc des expositions", 47.32976, 5.05438, "expo", "Parc des expos"),
    ("beaux-arts", "Musée des Beaux-Arts", 47.32163, 5.04236, "expo", "Beaux-Arts"),
    ("grand théâtre", "Grand Théâtre", 47.3226, 5.0440, "salle", "Grand Théâtre"),  # position approximative
]

ALERTS = [
    ("perturbation", "T2", "Trafic ralenti Godrans ↔ Monge",
     "Incident technique en cours de résolution. Retards de 5 à 10 minutes.", "En cours"),
    ("deviation", "L3 · L6", "Travaux rue de la Liberté",
     "Arrêts Liberté et Bourbonne non desservis. Arrêts provisoires rue Devosge.", "Jusqu'à nouvel ordre"),
    ("travaux", "Voirie", "Avenue du Drapeau — chaussée rétrécie",
     "Circulation alternée de 9 h à 16 h, en semaine.", "2 semaines"),
    ("info", "Vélodi", "Station Wilson en maintenance",
     "Station temporairement hors service. Stations proches : Darcy, Gare.", "Quelques jours"),
]

# Numéros nationaux (vérifiés). Ajoutez ici vos numéros locaux.
NUMBERS = [
    ("SAMU", "15", True),
    ("Police secours", "17", True),
    ("Pompiers", "18", True),
    ("Urgence européenne", "112", True),
    ("Urgence par SMS (sourds et malentendants)", "114", True),
    ("Samu social (sans-abri)", "115", False),
    ("Enfance en danger", "119", False),
    ("Pharmacie de garde", "3237", False),
]
