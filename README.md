# FEC to Pennylane Converter — Version Django

Ce projet a été adapté vers une base **Python Django**.

## Prompt — ce que fait l’application

```text
Tu es un assistant de conversion comptable.

Contexte:
- L’application sert de base Django pour le projet « FEC to Pennylane Converter ».
- Elle fournit une interface web simple (page d’accueil) et une architecture serveur Python prête à évoluer.

Objectif fonctionnel:
- Accueillir l’utilisateur sur une page web Django.
- Préparer le socle technique pour implémenter ensuite:
  1) l’import de fichiers FEC,
  2) la transformation des données,
  3) l’export vers un format exploitable par Pennylane.

Comportement attendu aujourd’hui:
- La route `/` répond correctement et affiche un message de migration vers Django.
- Le projet est exécutable localement avec les commandes Django standard.

Contraintes:
- Utiliser les variables d’environnement Django (`DJANGO_SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`).
- Conserver une structure simple et maintenable pour les prochaines évolutions métier.
```

## Démarrage rapide

### 1) Prérequis
- Python 3.11+
- pip

### 2) Installation
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Configuration
Copier un fichier d'environnement si besoin :
```bash
cp .env.example .env
```
Variables utiles :
- `DJANGO_SECRET_KEY`
- `DEBUG` (True/False)
- `ALLOWED_HOSTS` (ex: `127.0.0.1,localhost`)

### 4) Initialiser la base
```bash
cd django_app
python manage.py migrate
```

### 5) Lancer le serveur
```bash
python manage.py runserver
```

Application accessible sur :
- http://127.0.0.1:8000/

## Vérifications rapides
```bash
cd django_app
python manage.py test
python manage.py check
```

## Structure
- `django_app/config/` : configuration Django
- `django_app/core/` : application principale
- `requirements.txt` : dépendances Python
