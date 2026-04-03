une fois dans la VM Ubuntu, 
ouvvrir le terminal et éxecuter ces commandes :
  sudo mkdir -p /mnt/share
  
  sudo mount -t 9p -o trans=virtio share /mnt/share
  
  cp -r /mnt/share ~/ProjetSE
  
  sudo apt update
  
  sudo apt install -y g++ make python3 python3-pip
  
  pip3 install flask
  


  cd ~/ProjetSE
cat > Makefile << 'EOF'
CROSS_COMPILE ?=
CXX     = $(CROSS_COMPILE)g++
CFLAGS  = -Wall -g
LDFLAGS =
LOADLIBES = -lrt -lm

EXERCISES=		\
daemon			\

.PHONY: all
all : ${EXERCISES}

daemon: daemon.cpp
	$(CXX) $(CFLAGS) -o $@ $< $(LDFLAGS) $(LOADLIBES)

.PHONY: clean
clean :
	@rm -f core *.o *.out *.bb *.bbg *.gcov *.da *~
	@rm -f ${EXERCISES}
	@rm -rf fifos/

.PHONY: run
run: daemon
	@mkdir -p fifos
	python3 app.py
EOF

cd ~/ProjetSE
cat > daemon.cpp << 'CPPEOF'
/**
* MASTER MIAGE M1
* Cours Système
* Enseignant : Hendry F. Chame
*
* Daemon modifié pour écrire dans un named pipe (FIFO)
* Usage: ./daemon <subject_id> <activity_id> <fifo_path>
*/

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

void setIterationIndex(std::string fname){
    std::stringstream ss;
    ss << dirPrefix << "/index/" << fname << "_activity"<< my_activity << ".idx";
    std::string filename = ss.str();
    std::ofstream ofile;
    ofile.open(filename);
    ofile << my_index;
    ofile.close();
}

void getIterationIndex(std::string fname){
    my_index = 1;
    std::stringstream ss;
    ss << dirPrefix << "/index/" << fname << "_activity"<< my_activity << ".idx";
    std::string filename = ss.str();
    std::ifstream ifile;
    ifile.open(filename);
    if (ifile){
        std::string line;
        std::getline (ifile, line);
        my_index = atoi(line.c_str());
        ifile.close();
    }
}

void signal_handler(int signal){
    setIterationIndex(subject);
    if (fifo_fd >= 0) close(fifo_fd);
    exit(0);
}

int main(int argc, char *argv[]){
    my_sId = 0;
    my_activity = 0;
    my_index = 1;
    subject.append("subject");

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    if (argc < 4){
        std::cerr << "Usage: " << argv[0] << " <subject_id(1-10)> <activity_id(0-11)> <fifo_path>" << std::endl;
        return 1;
    }

    my_sId = atoi(argv[1]);
    my_activity = atoi(argv[2]);
    fifoPath = argv[3];
    subject.append(std::to_string(my_sId));

    getIterationIndex(subject);

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

    int k = 0;
    while (k++ < my_index){
        std::string line;
        std::getline(input, line);
    }

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
            usleep(50*1000);
        }
        my_index = 1;
        input.clear();
        input.seekg(0);
        std::getline(input, line);
    }
}
CPPEOF

pip3 install flask --break-system-packages

make 

make run
