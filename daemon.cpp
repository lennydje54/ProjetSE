#include <fstream>
#include <sstream>
#include <string.h>
#include <iostream>
#include <iomanip>
#include <vector>
#include <algorithm>
#include <unistd.h>
#include <csignal>
#include <sys/stat.h>   
#include <fcntl.h>      
#include <errno.h>      

const std::string dirPrefix = {"sensor/"};
std::string subject;
int my_sId, my_activity, my_index;
std::string fifoPath;
int fifo_fd = -1;


// sauvegarde la position de lecture actuelle dans un fichier .idx.
void setIterationIndex(std::string fname){
    std::stringstream ss;
    ss << dirPrefix << "/index/" << fname << "_activity"<< my_activity << ".idx";
    std::string filename = ss.str();
    std::ofstream ofile;
    ofile.open(filename);
    ofile << my_index;
    ofile.close();
}


// lit le fichier .idx pour récupérer la dernière position de lecture connue
void getIterationIndex(std::string fname){
    my_index = 1;
    std::stringstream ss;
    ss << dirPrefix << "/index/" << fname << "_activity"<< my_activity << ".idx";
    std::string filename = ss.str();
    std::ifstream ifile;
    ifile.open(filename);
    if (ifile){
        std::string line;
        std::getline(ifile, line);
        my_index = atoi(line.c_str());
        ifile.close();
    }
}


// sauvegarde l'index de lecture actuel et on ferme proprement le descripteur du FIFO avant de quitter
void signal_handler(int signal){
    setIterationIndex(subject);
    if (fifo_fd >= 0) close(fifo_fd);
    exit(0);
}


// on parse les arguments on ouvre le fichier CSV du patient demandé on crée le FIFO si nécessaire, puis on boucle en écrivant chaque ligne de données dans le pipe
int main(int argc, char *argv[]){
    my_sId = 0;
    my_activity = 0;
    my_index = 1;
    subject.append("subject");

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    // On vérifie qu'on a bien reçu les 3 arguments attendus
    if (argc < 4){
        std::cerr << "Usage: " << argv[0] << " <subject_id(1-10)> <activity_id(0-11)> <fifo_path>" << std::endl;
        return 1;
    }

    // On récupère les arguments passés en ligne de commande
    my_sId = atoi(argv[1]);
    my_activity = atoi(argv[2]);
    fifoPath = argv[3];
    subject.append(std::to_string(my_sId));

    // On essaie de reprendre là où on s'était arrêté la dernière fois
    getIterationIndex(subject);

    // On construit le chemin vers le fichier CSV correspondant au couple patient/activité,
    std::stringstream ss;
    ss << dirPrefix << "data/" << subject << "_activity" << my_activity << ".csv";
    std::string filename = ss.str();
    std::ifstream input(filename);

    if (!input.is_open()){
        std::cerr << "Erreur de lecture du fichier : " << filename << std::endl;
        return 1;
    }

    struct stat st;
    if (stat(fifoPath.c_str(), &st) != 0) {
        if (mkfifo(fifoPath.c_str(), 0666) != 0) {
            std::cerr << "Erreur de création du FIFO : " << fifoPath << " - " << strerror(errno) << std::endl;
            return 1;
        }
    }


    fifo_fd = open(fifoPath.c_str(), O_WRONLY);
    if (fifo_fd < 0) {
        std::cerr << "Erreur d'ouverture du FIFO : " << fifoPath << " - " << strerror(errno) << std::endl;
        return 1;
    }

    // On avance dans le fichier CSV jusqu'à la ligne où on s'était arrêté.
    int k = 0;
    while (k++ < my_index){
        std::string line;
        std::getline(input, line);
    }

    // on lit le fichier CSV ligne par ligne et on écrit chaque ligne dans le FIFO. Quand on arrive à la fin du fichier on
    // revient au début pour simuler une acquisition continue
    while(true){
        std::string line;
        while(std::getline(input, line)){
            my_index++;

            line += "\n";

            ssize_t written = write(fifo_fd, line.c_str(), line.size());
            if (written < 0) {
                setIterationIndex(subject);
                close(fifo_fd);
                return 0;
            }

            // On attend 50ms entre chaque ligne pour simuler un débit réaliste
            usleep(50*1000);
        }

        // On a atteint la fin du fichier CSV, on repart du début
        my_index = 1;
        input.clear();
        input.seekg(0);
        std::getline(input, line); // on saute l'en-tête CSV 
    }
}
