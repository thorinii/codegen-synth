#define _GNU_SOURCE

#include <unistd.h>
#include <stdbool.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <pthread.h>
#include <string.h>

#include <jack/jack.h>
#include <jack/midiport.h>


inline bool startsWith(const char *pre, const char *str) {
  size_t lenpre = strlen(pre);
  size_t lenstr = strlen(str);
  return lenstr < lenpre ? false : strncmp(pre, str, lenpre) == 0;
}


static bool going = false;
jack_port_t *input_midi_port;
jack_port_t *output_port;
jack_client_t *client;

int VAR_COUNT; double vars[0]; /* %%STORAGE%% */


static double make_sample() {
  /* %%PROCESS%% */
}

int process (jack_nframes_t nframes, void *arg) {
  void *midi_in = jack_port_get_buffer(input_midi_port, nframes);
  int events = jack_midi_get_event_count(midi_in);
  jack_midi_event_t event;
  for (int i = 0; i < events; i++) {
    if (jack_midi_event_get(&event, midi_in, i) != 0) continue;
    if (event.size < 1) continue;

    int type = event.buffer[0] & 0xF0;
    int channel = event.buffer[0] & 0x0F;
    if (type == 0xF0) {
      type = channel;
      printf("{\"msg\":\"midi\",\"type\":\"sys\",\"msg\":%d}\n", type);
    } else if (type == 176) {
      int controller = event.buffer[1];
      int value = event.buffer[2];
      printf("{\"msg\":\"midi\",\"type\":\"cc\",\"channel\":%d,\"controller\":%d,\"value\":%d}\n", channel, controller, value);
    } else if (type == 128 || type == 144) {
      printf("{\"msg\":\"midi\",\"type\":\"note-%s\",", type == 128 ? "up" : "down");
      printf("\"channel\":%d,", channel);
      printf("\"note\":%d,\"velocity\":%d}\n", event.buffer[1], event.buffer[2]);
    } else {
      printf("{\"msg\":\"midi\",\"type\":\"unknown:%d\",\"channel\":%d,\"extra\":[", type, channel);
      for (int b = 1; b < event.size; b++) {
        if (b == 1) printf("%d", (unsigned int) event.buffer[b]);
        else printf(",%d", (unsigned int) event.buffer[b]);
      }
      printf("]}\n");
    }
  }

  jack_default_audio_sample_t *out = (jack_default_audio_sample_t *) jack_port_get_buffer(output_port, nframes);
  if (going) {
    for (int i = 0; i < nframes; i++) {
      make_sample();
      make_sample();
      make_sample();
      out[i] = make_sample();
    }
  } else {
    for (int i = 0; i < nframes; i++) {
      out[i] = 0.0;
    }
  }
  return 0;
}

/**
 * JACK calls this shutdown_callback if the server ever shuts down or
 * decides to disconnect the client.
 */
void jack_shutdown (void *arg) {
  exit(1);
}

void *msg_thread(void *arg) {
  char *line = NULL;
  size_t bufferLength = 0;
  int lineLength = 0;
  while ((lineLength = getline(&line, &bufferLength, stdin)) >= 0) {
    int var = 0;
    double value = 0;

    if (startsWith("start", line)) {
      going = true;
    } else if (startsWith("set", line) && sscanf(line, "set %d %lf", &var, &value)) {
      if (var >= 0 && var < VAR_COUNT) {
        vars[var] = value;
      } else {
        fprintf(stderr, "invalid var set request: %d = %f\n", var, value);
      }
    }
  }
  free(line);

  return NULL;
}

int main (int argc, char *argv[]) {
  setbuf(stdout, NULL);

  /* %%INIT%% */

  pthread_t msg_thread_id;
  if (pthread_create(&msg_thread_id, NULL, &msg_thread, NULL) != 0) {
    fprintf(stderr, "Failed to start msg thread\n");
    return 1;
  }

  const char **ports;
  const char *client_name = "simple";
  const char *server_name = NULL;
  jack_options_t options = JackNullOption;
  jack_status_t status;

  /* open a client connection to the JACK server */
  client = jack_client_open(client_name, options, &status, server_name);
  if (client == NULL) {
    printf("Failed to create client\n");
    return 1;
  }

  jack_set_process_callback(client, process, 0);
  jack_on_shutdown(client, jack_shutdown, 0);

  output_port = jack_port_register(client, "output", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  if (output_port == NULL) {
    printf("Failed to open an output port\n");
    return 1;
  }

  input_midi_port = jack_port_register(client, "midi in", JACK_DEFAULT_MIDI_TYPE, JackPortIsInput, 0);
  if (input_midi_port == NULL) {
    printf("Failed to open a MIDI port\n");
    return 1;
  }

  if (jack_activate(client)) {
    printf("Failed to active client\n");
    return 1;
  }

  ports = jack_get_ports(client, NULL, NULL, JackPortIsInput);
  int i = 0;
  while (ports[i] != NULL) {
    if (jack_connect (client, jack_port_name (output_port), ports[i])) {
      // cerr << "cannot connect output ports" << endl;
    }
    i++;
  }
  free(ports);

  ports = jack_get_ports(client, NULL, JACK_DEFAULT_MIDI_TYPE, JackPortIsOutput | JackPortIsPhysical);
  i = 0;
  while (ports[i] != NULL) {
    if (jack_connect (client, ports[i], jack_port_name(input_midi_port))) {
      printf("Cannot connect output ports\n");
    }
    i++;
  }
  free(ports);

  printf("{\"msg\":\"start\",\"sample_rate\":%d}\n", jack_get_sample_rate(client));

  /* keep running until stopped by the user */
  sleep (-1);

  jack_client_close(client);
  return 0;
}
