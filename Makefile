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
