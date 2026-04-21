# FEC to Pennylane Converter — Version Django

Ce projet a été adapté vers une base **Python Django**.

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
