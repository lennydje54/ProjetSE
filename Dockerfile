# Ce Dockerfile construit une image Ubuntu contenant tout ce qu'il faut pour
# faire tourner l'application : le compilateur C++ pour builder le daemon,
# Python et Flask pour le serveur web, et tout le code source du projet.

# On part d'une image Ubuntu 22.04 pour respecter les contraintes du projet
# (Ubuntu 18.04, 20.04 ou 22.04 selon le cahier des charges)
FROM ubuntu:22.04

# On évite que l'installation des paquets nous demande des questions interactives
ENV DEBIAN_FRONTEND=noninteractive

# On installe les dépendances système : g++ pour compiler le daemon C++,
# make pour le build, et python3 + pip pour le serveur Flask
RUN apt-get update && apt-get install -y \
    g++ \
    make \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# On installe Flask via pip
RUN pip3 install --no-cache-dir flask

# On définit le dossier de travail à l'intérieur du conteneur
WORKDIR /app

# On copie tout le code source dans l'image
COPY . /app

# On compile le daemon C++ lors de la construction de l'image, comme ça
# il est déjà prêt à être utilisé au démarrage du conteneur
RUN make

# On crée le dossier pour les named pipes (FIFOs) qui seront utilisés
# pour la communication entre le daemon C++ et le serveur Flask
RUN mkdir -p /app/fifos

# Le serveur Flask écoute sur le port 5000
EXPOSE 5000

# Commande de démarrage : on lance le serveur Flask qui se chargera
# lui-même de démarrer les daemons C++ quand l'utilisateur clique sur
# "Démarrer l'acquisition" dans l'interface web
CMD ["python3", "app.py"]
