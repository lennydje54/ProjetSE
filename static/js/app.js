$(document).ready(function () {
    const MAX_POINTS = 100;
    
    let refreshRate = 500;

    let refreshInterval = null;

    let activeSessions = {};

    const SENSOR_COLORS = {
        alx: '#e6194b', aly: '#3cb44b', alz: '#4363d8',
        glx: '#f58231', gly: '#911eb4', glz: '#42d4f4',
        arx: '#f032e6', ary: '#bfef45', arz: '#fabed4',
        grx: '#469990', gry: '#dcbeff', grz: '#9A6324'
    };

    const SENSOR_LABELS = {
        alx: 'Accel. X (cheville G.)',  aly: 'Accel. Y (cheville G.)',  alz: 'Accel. Z (cheville G.)',
        glx: 'Gyro. X (cheville G.)',   gly: 'Gyro. Y (cheville G.)',   glz: 'Gyro. Z (cheville G.)',
        arx: 'Accel. X (avant-bras D.)',ary: 'Accel. Y (avant-bras D.)',arz: 'Accel. Z (avant-bras D.)',
        grx: 'Gyro. X (avant-bras D.)', gry: 'Gyro. Y (avant-bras D.)', grz: 'Gyro. Z (avant-bras D.)'
    };

    // On parcourt toutes les cases à cocher qui ont la classe "sensor-check"
    // et on retourne un tableau avec les noms des capteurs sélectionnés.
    function getSelectedSensors() {
        var sensors = [];
        $('.sensor-check:checked').each(function () {
            sensors.push($(this).val());
        });
        return sensors;
    }


    // Quand l'utilisateur déplace le slider, on met à jour la valeur affichée
    // et on redémarre le polling avec le nouveau délai 
    $('#refreshRate').on('input', function () {
        refreshRate = parseInt($(this).val());
        $('#refreshValue').text(refreshRate);
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = setInterval(fetchData, refreshRate);
        }
    });

    $('#btnSelectAll').click(function () {
        $('.sensor-check').prop('checked', true);
        updateChartDatasets();
    });

    $('#btnDeselectAll').click(function () {
        $('.sensor-check').prop('checked', false);
        updateChartDatasets();
    });

    // Quand l'utilisateur coche ou décoche un capteur individuellement,
    // on met à jour les datasets de tous les graphiques actifs
    $('.sensor-check').change(function () {
        updateChartDatasets();
    });

    // Quand l'utilisateur clique sur le bouton "Démarrer l'acquisition",
    // on récupère le patient et l'activité sélectionnés dans les menus
    // déroulants, on vérifie que cette combinaison n'est pas déjà active,
    // puis on envoie une requête POST au serveur pour lancer le daemon.
    $('#btnStart').click(function () {
        var subjectId = parseInt($('#selectPatient').val());
        var activityId = parseInt($('#selectActivity').val());
        var sessionKey = subjectId + '_' + activityId;

        // On empêche l'utilisateur de lancer deux fois la même session
        if (activeSessions[sessionKey]) {
            alert('Cette session est déjà active !');
            return;
        }

        // On évite les double-clics
        var btn = $(this);
        btn.prop('disabled', true).text('Démarrage...');

        $.ajax({
            url: '/api/start',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                subject_id: subjectId,
                activity_id: activityId
            }),
            success: function (response) {
                // Si le serveur confirme le démarrage, on crée le panneau
                // de visualisation et on lance le polling des données
                if (response.status === 'started') {
                    createChartPanel(response.session_key, subjectId, activityId, response.activity_name);
                    startPolling();
                }
            },
            error: function (xhr) {
                var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Erreur inconnue';
                alert('Erreur : ' + msg);
            },
            complete: function () {
                // On réactive le bouton dans tous les cas
                btn.prop('disabled', false).text("Démarrer l'acquisition");
            }
        });
    });

    // Cette fonction crée dynamiquement un panneau HTML contenant un canvas
    // Chart.js pour visualiser les données d'une session.
    function createChartPanel(sessionKey, subjectId, activityId, activityName) {

        // S'il n'y a aucune session active, on efface le message d'accueil
        if (Object.keys(activeSessions).length === 0) {
            $('#chartsContainer').empty();
        }

        var panelHtml =
            '<div class="col-md-6 chart-col" id="panel_' + sessionKey + '">' +
                '<div class="chart-panel">' +
                    '<div class="chart-header">' +
                        '<div>' +
                            '<span class="status-badge"></span>' +
                            '<span class="chart-title">Patient ' + subjectId + '</span>' +
                            '<br><span class="chart-subtitle">' + activityName + '</span>' +
                        '</div>' +
                        '<button class="btn btn-danger btn-stop btn-sm" data-session="' + sessionKey + '">' +
                            'Arrêter' +
                        '</button>' +
                    '</div>' +
                    '<canvas id="chart_' + sessionKey + '"></canvas>' +
                '</div>' +
            '</div>';

        $('#chartsContainer').append(panelHtml);

        // On initialise le graphique Chart.js avec un dataset par capteur sélectionné.
        // Chaque dataset représente une courbe sur le graphique avec sa propre couleur.
        var ctx = document.getElementById('chart_' + sessionKey).getContext('2d');
        var selectedSensors = getSelectedSensors();

        var datasets = selectedSensors.map(function (sensor) {
            return {
                label: SENSOR_LABELS[sensor] || sensor,
                data: [],
                borderColor: SENSOR_COLORS[sensor],
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                pointRadius: 0,       //  juste la courbe
                tension: 0.3,         // lissage de la courbe
                sensorKey: sensor  
            };
        });

        var chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],        // les numéros d'échantillons 
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },    
                interaction: { intersect: false, mode: 'index' },
                scales: {
                    x: {
                        display: true,
                        title: { display: true, text: 'Échantillons' },
                        ticks: { maxTicksLimit: 10 }
                    },
                    y: {
                        display: true,
                        title: { display: true, text: 'Valeur' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    }
                }
            }
        });

        // On enregistre la session dans notre dictionnaire côté client
        activeSessions[sessionKey] = {
            chart: chart,
            subjectId: subjectId,
            activityId: activityId,
            activityName: activityName,
            sampleCount: 0        // compteur pour numéroter les échantillons sur l'axe X
        };

        // On met à jour la liste des sessions actives dans le panneau de gauche
        updateSessionList();

        // On attache l'événement click au bouton Arrêter de ce panneau
        $('#panel_' + sessionKey + ' .btn-stop').click(function () {
            stopSession(sessionKey);
        });
    }


    // Quand l'utilisateur coche ou décoche un capteur, on doit mettre à jour
    // les datasets de tous les graphiques actifs.
    function updateChartDatasets() {
        var selectedSensors = getSelectedSensors();

        $.each(activeSessions, function (key, session) {
            var chart = session.chart;

            var newDatasets = selectedSensors.map(function (sensor) {
                // On cherche si ce capteur avait déjà un dataset avec des données
                var existing = null;
                chart.data.datasets.forEach(function (ds) {
                    if (ds.sensorKey === sensor) existing = ds;
                });

                // Si oui, on le réutilise tel quel pour ne pas perdre l'historique
                if (existing) {
                    return existing;
                }

                // Sinon, on en crée un nouveau vide pour ce capteur
                return {
                    label: SENSOR_LABELS[sensor] || sensor,
                    data: [],
                    borderColor: SENSOR_COLORS[sensor],
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3,
                    sensorKey: sensor
                };
            });

            chart.data.datasets = newDatasets;
            chart.update('none');
        });
    }


    // On envoie une requête POST au serveur pour arrêter le daemon puis
    // on détruit le graphique Chart.js et on retire le panneau du DOM.
    function stopSession(sessionKey) {
        $.ajax({
            url: '/api/stop',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ session_key: sessionKey }),
            success: function () {
                if (activeSessions[sessionKey]) {
                    activeSessions[sessionKey].chart.destroy();
                    delete activeSessions[sessionKey];
                }
                $('#panel_' + sessionKey).remove();
                updateSessionList();

                // S'il n'y a plus aucune session active, on arrête le polling et on réaffiche le message d'accueil
                if (Object.keys(activeSessions).length === 0) {
                    stopPolling();
                    $('#chartsContainer').html(
                        '<div class="col-12 text-center text-muted mt-5">' +
                            '<h4>Démarrez une acquisition pour visualiser les données</h4>' +
                            '<p>Sélectionnez un patient et une activité, puis cliquez sur "Démarrer l\'acquisition".</p>' +
                        '</div>'
                    );
                }
            }
        });
    }


    // On démarre un setInterval() qui appelle fetchData() à chaque cycle.
    function startPolling() {
        if (refreshInterval) return;
        refreshInterval = setInterval(fetchData, refreshRate);
    }

    // On arrête le polling quand il n'y a plus de session active pour ne pas envoyer des requêtes inutiles au serveur
    function stopPolling() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }

    // C'est cette fonction qui est appelée à chaque cycle du polling.
    function fetchData() {
        var keys = Object.keys(activeSessions);
        if (keys.length === 0) return;

        var sensors = getSelectedSensors();
        if (sensors.length === 0) return;

        $.ajax({
            url: '/api/data',
            method: 'GET',
            data: {
                sessions: keys.join(','),
                sensors: sensors.join(',')
            },
            success: function (response) {
                // On parcourt la réponse qui contient les données de chaque session
                $.each(response, function (sessionKey, sessionData) {
                    if (!activeSessions[sessionKey]) return;
                    if (!sessionData.data || sessionData.data.length === 0) return;

                    var chart = activeSessions[sessionKey].chart;
                    var labels = chart.data.labels;

                    // On ajoute chaque nouveau point de données au graphique
                    sessionData.data.forEach(function (point) {
                        activeSessions[sessionKey].sampleCount++;
                        labels.push(activeSessions[sessionKey].sampleCount);

                        // Pour chaque dataset on ajoute la valeur correspondante ou null si le capteur n'est pas présent dans ce point de données
                        chart.data.datasets.forEach(function (dataset) {
                            var sensorKey = dataset.sensorKey;
                            if (point.values && point.values[sensorKey] !== undefined) {
                                dataset.data.push(point.values[sensorKey]);
                            } else {
                                dataset.data.push(null);
                            }
                        });
                    });
                    while (labels.length > MAX_POINTS) {
                        labels.shift();
                        chart.data.datasets.forEach(function (dataset) {
                            dataset.data.shift();
                        });
                    }
                    chart.update('none');
                });
            },
            error: function () {
                console.warn('Erreur lors de la récupération des données');
            }
        });
    }


    // On reconstruit la liste HTML à chaque changement 
    function updateSessionList() {
        var list = $('#sessionList');
        list.empty();

        var keys = Object.keys(activeSessions);
        if (keys.length === 0) {
            list.append('<li class="list-group-item text-muted">Aucune session active</li>');
            return;
        }

        keys.forEach(function (key) {
            var session = activeSessions[key];
            var item =
                '<li class="list-group-item">' +
                    '<span>' +
                        '<span class="status-badge"></span>' +
                        'Patient ' + session.subjectId + ' - ' + session.activityName +
                    '</span>' +
                    '<button class="btn btn-outline-danger btn-sm py-0 px-2 btn-stop-list" data-session="' + key + '">' +
                        '&times;' +
                    '</button>' +
                '</li>';
            list.append(item);
        });

        // On attache les événements aux boutons × de la liste
        $('.btn-stop-list').click(function () {
            stopSession($(this).data('session'));
        });
    }
});
