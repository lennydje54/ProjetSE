import os
import subprocess
import threading
import json
import signal
import time
import select
import atexit
from flask import Flask, render_template, jsonify, request

app = Flask(__name__, static_folder='static', template_folder='templates')

FIFO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fifos')
DAEMON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daemon')


SENSOR_COLUMNS = ['alx', 'aly', 'alz', 'glx', 'gly', 'glz',
                  'arx', 'ary', 'arz', 'grx', 'gry', 'grz']


ACTIVITIES = {
    0: "Debout immobile",
    1: "Assis et détendu",
    2: "Allongé",
    3: "Marche",
    4: "Monter les escaliers",
    5: "Penchement de la taille",
    6: "Élévation frontale des bras",
    7: "Flexion des genoux",
    8: "Vélo",
    9: "Jogging",
    10: "Course à pied",
    11: "Saut avant/arrière"
}

sessions = {}
sessions_lock = threading.Lock()


def create_fifo_dir():
    # On crée le dossier "fifos/" au démarrage du serveur s'il n'existe pas encore.
    os.makedirs(FIFO_DIR, exist_ok=True)


def get_session_key(subject_id, activity_id):
    # On génère une clé unique pour identifier chaque session
    return f"{subject_id}_{activity_id}"


def fifo_reader(session_key):
    # lire en continu les données que le daemon C++ écrit dans le named pipe de les parser et de les stocker dans un buffer accessible par les routes Flask.

    with sessions_lock:
        if session_key not in sessions:
            return
        session = sessions[session_key]

    fifo_path = session['fifo_path']

    max_buffer = 200

    try:
        # On ouvre le FIFO en lecture
        fd = os.open(fifo_path, os.O_RDONLY)
        fifo_file = os.fdopen(fd, 'r')

        while session['active']:
            line = fifo_file.readline()
            if not line:
                # Si readline() retourne une chaîne vide, ça veut dire que le daemon a fermé le pipe 
                break
            line = line.strip()
            if not line:
                continue

            # Chaque ligne du CSV a ce format : "index,alx,aly,alz,glx,gly,glz,arx,ary,arz,grx,gry,grz"
            parts = line.split(',')
            if len(parts) >= 13:
                try:
                    data_point = {
                        'timestamp': time.time(),
                        'values': {}
                    }
                    # On parcourt les 12 colonnes de capteurs et on convertit chaque valeur en nombre flottant pour pouvoir les manipuler facilement côté frontend
                    for i, col in enumerate(SENSOR_COLUMNS):
                        data_point['values'][col] = float(parts[i + 1])

                    with sessions_lock:
                        if session_key in sessions:
                            buf = sessions[session_key]['data_buffer']
                            buf.append(data_point)
                            # Si le buffer dépasse la taille max, on ne garde que
                            # les données les plus récentes
                            if len(buf) > max_buffer:
                                sessions[session_key]['data_buffer'] = buf[-max_buffer:]
                except (ValueError, IndexError):
                    pass

        fifo_file.close()
    except Exception as e:
        print(f"Erreur lecture FIFO {session_key}: {e}")
    finally:
        # Quand le thread se termine on marque la session comme inactive pour que le frontend sache qu'il n'y a plus de données à attendre
        with sessions_lock:
            if session_key in sessions:
                sessions[session_key]['active'] = False


def start_session(subject_id, activity_id):

    session_key = get_session_key(subject_id, activity_id)

    # On vérifie que cette session n'est pas déjà en cours
    with sessions_lock:
        if session_key in sessions and sessions[session_key]['active']:
            return session_key

    # On crée le named pipe dans le dossier fifos/.
    fifo_path = os.path.join(FIFO_DIR, f"fifo_{session_key}")
    try:
        os.mkfifo(fifo_path)
    except FileExistsError:
        os.remove(fifo_path)
        os.mkfifo(fifo_path)

    # On prépare le dictionnaire qui contient tout l'état de cette session
    session = {
        'subject_id': subject_id,
        'activity_id': activity_id,
        'fifo_path': fifo_path,
        'process': None,         
        'reader_thread': None,   
        'data_buffer': [],       
        'active': True,          
        'last_read_index': 0     
    }

    with sessions_lock:
        sessions[session_key] = session

    reader = threading.Thread(target=fifo_reader, args=(session_key,), daemon=True)
    reader.start()

    try:
        proc = subprocess.Popen(
            [DAEMON_PATH, str(subject_id), str(activity_id), fifo_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE
        )
    except Exception as e:
        # Si le daemon ne peut pas démarrer on nettoie tout et on remonte l'erreur
        with sessions_lock:
            sessions[session_key]['active'] = False
            del sessions[session_key]
        os.remove(fifo_path)
        raise RuntimeError(f"Impossible de démarrer le daemon: {e}")

    with sessions_lock:
        if session_key in sessions:
            sessions[session_key]['process'] = proc
            sessions[session_key]['reader_thread'] = reader

    return session_key


def stop_session(session_key):
    # Cette fonction arrête proprement une session : elle envoie un signal
    # SIGTERM au daemon C++ pour qu'il sauvegarde son index et se termine,
    # puis elle supprime le FIFO et nettoie le dictionnaire des sessions

    with sessions_lock:
        if session_key not in sessions:
            return False
        session = sessions[session_key]
        session['active'] = False

    # On envoie SIGTERM au daemon pour qu'il se termine proprement
    # Si après 3 secondes il n'a pas quitté, on le tue de force avec SIGKILL
    proc = session.get('process')
    if proc and proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    # On supprime le fichier FIFO du système de fichiers pour ne pas laisser traîner des fichiers inutiles
    fifo_path = session.get('fifo_path')
    if fifo_path and os.path.exists(fifo_path):
        try:
            os.remove(fifo_path)
        except OSError:
            pass

    with sessions_lock:
        if session_key in sessions:
            del sessions[session_key]

    return True



@app.route('/')
def index():
    # Route principale qui sert la page HTML de l'application.
    return render_template('index.html', activities=ACTIVITIES, sensors=SENSOR_COLUMNS)


@app.route('/api/start', methods=['POST'])
def api_start():
    # Cette route est appelée quand l'utilisateur clique sur "Démarrer l'acquisition"
    data = request.get_json()
    subject_id = data.get('subject_id')
    activity_id = data.get('activity_id')

    if subject_id is None or activity_id is None:
        return jsonify({'error': 'subject_id et activity_id requis'}), 400

    subject_id = int(subject_id)
    activity_id = int(activity_id)

    # On vérifie que les identifiants sont dans les plages valides
    if not (1 <= subject_id <= 10):
        return jsonify({'error': 'subject_id doit être entre 1 et 10'}), 400
    if not (0 <= activity_id <= 11):
        return jsonify({'error': 'activity_id doit être entre 0 et 11'}), 400

    try:
        session_key = start_session(subject_id, activity_id)
        return jsonify({
            'status': 'started',
            'session_key': session_key,
            'subject_id': subject_id,
            'activity_id': activity_id,
            'activity_name': ACTIVITIES.get(activity_id, 'Inconnu')
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/stop', methods=['POST'])
def api_stop():
    # Cette route est appelée quand l'utilisateur clique sur le bouton "Arrêter" d'un graphique
    data = request.get_json()
    session_key = data.get('session_key')

    if not session_key:
        return jsonify({'error': 'session_key requis'}), 400

    success = stop_session(session_key)
    return jsonify({'status': 'stopped' if success else 'not_found'})


@app.route('/api/data', methods=['GET'])
def api_data():
    # C'est la route la plus fréquemment appelée, le frontend la sollicite à chaque cycle de rafraîchissement pour récupérer les nouvelles données.
    session_keys = request.args.get('sessions', '')
    sensors = request.args.get('sensors', '')

    if not session_keys:
        return jsonify({'error': 'sessions parameter requis'}), 400

    keys = session_keys.split(',')
    sensor_list = sensors.split(',') if sensors else SENSOR_COLUMNS

    result = {}
    with sessions_lock:
        for key in keys:
            if key in sessions and sessions[key]['active']:
                buf = sessions[key]['data_buffer']
                last_idx = sessions[key].get('last_read_index', 0)

                # On récupère uniquement les nouveaux points depuis le dernier appel
                new_data = buf[last_idx:] if last_idx < len(buf) else []
                sessions[key]['last_read_index'] = len(buf)

                # On filtre pour ne garder que les capteurs demandés par l'utilisateur
                filtered = []
                for dp in new_data:
                    point = {'timestamp': dp['timestamp'], 'values': {}}
                    for s in sensor_list:
                        if s in dp['values']:
                            point['values'][s] = dp['values'][s]
                    filtered.append(point)

                result[key] = {
                    'subject_id': sessions[key]['subject_id'],
                    'activity_id': sessions[key]['activity_id'],
                    'data': filtered,
                    'active': True
                }
            elif key in sessions:
                result[key] = {'active': False, 'data': []}

    return jsonify(result)


@app.route('/api/sessions', methods=['GET'])
def api_sessions():
    with sessions_lock:
        active = {}
        for key, session in sessions.items():
            active[key] = {
                'subject_id': session['subject_id'],
                'activity_id': session['activity_id'],
                'activity_name': ACTIVITIES.get(session['activity_id'], 'Inconnu'),
                'active': session['active'],
                'buffer_size': len(session['data_buffer'])
            }
    return jsonify(active)


def cleanup():
    # assure que tous les daemons sont bien terminés et que les fichiers FIFO sont supprimés pour ne pas laisser de traces.
    with sessions_lock:
        keys = list(sessions.keys())
    for key in keys:
        stop_session(key)

    # On nettoie aussi les éventuels FIFOs orphelins
    if os.path.exists(FIFO_DIR):
        for f in os.listdir(FIFO_DIR):
            path = os.path.join(FIFO_DIR, f)
            try:
                os.remove(path)
            except OSError:
                pass


# On enregistre la fonction de nettoyage pour qu'elle soit exécutée automatiquement à la fermeture du serveur
atexit.register(cleanup)

if __name__ == '__main__':
    create_fifo_dir()
    app.run(host='0.0.0.0', port=5000, debug=True)
