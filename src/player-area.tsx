import * as React from "react";
import produce from "immer";
import useAsyncEffect from "@n1ru4l/use-async-effect";
import debounce from "lodash/debounce";
import { ReactRelayContext } from "relay-hooks";
import styled from "@emotion/styled/macro";
import { loadImage } from "./util";
import { Toolbar } from "./toolbar";
import * as Icons from "./feather-icons";
import { SplashScreen } from "./splash-screen";
import { AuthenticationScreen } from "./authentication-screen";
import { buildApiUrl } from "./public-url";
import { AuthenticatedAppShell } from "./authenticated-app-shell";
import { useSocket } from "./socket";
import { useStaticRef } from "./hooks/use-static-ref";
import { animated, useSpring, to } from "react-spring";
import { MapView, MapControlInterface, UpdateTokenContext } from "./map-view";
import { useGesture } from "react-use-gesture";
import { ToastProvider } from "react-toast-notifications";
import { v4 as uuid } from "uuid";
import { useWindowDimensions } from "./hooks/use-window-dimensions";
import { usePersistedState } from "./hooks/use-persisted-state";
import { PlayerMapTool } from "./map-tools/player-map-tool";
import { MapEntity } from "./map-typings";
import {
  ComponentWithPropsTuple,
  FlatContextProvider,
} from "./flat-context-provider";
import { MarkAreaToolContext } from "./map-tools/mark-area-map-tool";
import {
  NoteWindowActionsContext,
  useNoteWindowActions,
} from "./dm-area/token-info-aside";

const ToolbarContainer = styled(animated.div)`
  position: absolute;
  display: flex;
  justify-content: center;
  pointer-events: none;
  user-select: none;
  top: 0;
  left: 0;
`;

const AbsoluteFullscreenContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`;

type MarkedArea = {
  id: string;
  x: number;
  y: number;
};

const createCacheBusterString = () =>
  encodeURIComponent(`${Date.now()}_${uuid()}`);

const PlayerMap: React.FC<{
  fetch: typeof fetch;
  pcPassword: string;
  socket: ReturnType<typeof useSocket>;
  isMapOnly: boolean;
}> = ({ fetch, pcPassword, socket, isMapOnly }) => {
  const [currentMap, setCurrentMap] = React.useState<null | MapEntity>(null);
  const currentMapRef = React.useRef(currentMap);

  const [mapImage, setMapImage] = React.useState<HTMLImageElement | null>(null);
  const [fogImage, setFogImage] = React.useState<HTMLImageElement | null>(null);

  const mapId = currentMap ? currentMap.id : null;
  const showSplashScreen = mapId === null;

  const controlRef = React.useRef<MapControlInterface | null>(null);
  /**
   * used for canceling pending requests in case there is a new update incoming.
   * should be either null or an array of tasks returned by loadImage
   */
  const pendingFogImageLoad = React.useRef<(() => void) | null>(null);
  const [markedAreas, setMarkedAreas] = React.useState<MarkedArea[]>(() => []);

  const [refetchTrigger, setRefetchTrigger] = React.useState(0);

  const onReceiveMap = React.useCallback((data: { map: MapEntity }) => {
    if (!data) {
      return;
    }
    if (window.document.visibilityState === "hidden") {
      return;
    }

    if (pendingFogImageLoad.current) {
      pendingFogImageLoad.current?.();
      pendingFogImageLoad.current = null;
    }

    /**
     * Hide map (show splashscreen)
     */
    if (!data.map) {
      currentMapRef.current = null;
      setCurrentMap(null);
      setFogImage(null);
      setMapImage(null);
      return;
    }
    /**
     * Fog has updated
     */
    if (currentMapRef.current && currentMapRef.current.id === data.map.id) {
      const imageUrl = buildApiUrl(
        // prettier-ignore
        `/map/${data.map.id}/fog-live?cache_buster=${createCacheBusterString()}&authorization=${encodeURIComponent(pcPassword)}`
      );

      const task = loadImage(imageUrl);
      pendingFogImageLoad.current = () => task.cancel();

      task.promise
        .then((fogImage) => {
          setFogImage(fogImage);
        })
        .catch(() => {
          console.log("Cancel loading image.");
        });
      return;
    }

    /**
     * Load new map
     */
    currentMapRef.current = data.map;

    const mapImageUrl = buildApiUrl(
      // prettier-ignore
      `/map/${data.map.id}/map?authorization=${encodeURIComponent(pcPassword)}`
    );

    const fogImageUrl = buildApiUrl(
      // prettier-ignore
      `/map/${data.map.id}/fog-live?cache_buster=${createCacheBusterString()}&authorization=${encodeURIComponent(pcPassword)}`
    );

    const loadMapImageTask = loadImage(mapImageUrl);
    const loadFogImageTask = loadImage(fogImageUrl);

    pendingFogImageLoad.current = () => {
      loadMapImageTask.cancel();
      loadFogImageTask.cancel();
    };

    Promise.all([loadMapImageTask.promise, loadFogImageTask.promise])
      .then(([mapImage, fogImage]) => {
        setMapImage(mapImage);
        setFogImage(fogImage);
        setCurrentMap(data.map);
      })
      .catch(() => {
        console.log("Cancel loading image.");
      });
  }, []);

  useAsyncEffect(
    function* (_, cast) {
      const result = yield* cast(
        fetch("/active-map").then((res) => res.json())
      );
      const activeMap = result.data.activeMap;

      if (activeMap) {
        onReceiveMap({ map: activeMap });
      }

      return () => {
        if (pendingFogImageLoad.current) {
          pendingFogImageLoad.current?.();
          pendingFogImageLoad.current = null;
        }
      };
    },
    [socket, pcPassword, refetchTrigger]
  );

  React.useEffect(() => {
    socket.on("map update", onReceiveMap);
    socket.on("mark area", (data: { id: string; x: number; y: number }) => {
      if (window.document.visibilityState === "hidden") {
        return;
      }
      setMarkedAreas((markedAreas) => [
        ...markedAreas,
        {
          id: data.id,
          x: data.x,
          y: data.y,
        },
      ]);
    });
    return () => {
      socket.off("map update");
      socket.off("mark area");
    };
  }, [socket]);

  React.useEffect(() => {
    const contextmenuListener = (ev: Event) => {
      ev.preventDefault();
    };
    return () => {
      window.addEventListener("contextmenu", contextmenuListener);
      window.removeEventListener("contextmenu", contextmenuListener);
    };
  }, []);

  React.useEffect(() => {
    if (!mapId) return;
    const eventName = `token:mapId:${mapId}`;

    socket.on(eventName, ({ type, data }: { type: string; data: any }) => {
      if (type === "add") {
        setCurrentMap(
          produce((map) => {
            map.tokens.push(data.token);
          })
        );
      } else if (type === "update") {
        setCurrentMap(
          produce((map: MapEntity | null) => {
            if (map) {
              map.tokens = map.tokens.map((token) => {
                if (token.id !== data.token.id) return token;
                return {
                  ...token,
                  ...data.token,
                };
              });
            }
          })
        );
      } else if (type === "remove") {
        setCurrentMap(
          produce((map: MapEntity | null) => {
            if (map) {
              map.tokens = map.tokens = map.tokens.filter(
                (token) => token.id !== data.tokenId
              );
            }
          })
        );
      }
    });

    return () => {
      socket.off(eventName);
    };
  }, [socket, mapId]);

  React.useEffect(() => {
    const listener = () => {
      if (document.hidden === false) {
        setRefetchTrigger((i) => i + 1);
      }
    };

    window.document.addEventListener("visibilitychange", listener, false);

    return () =>
      window.document.removeEventListener("visibilitychange", listener, false);
  }, []);

  const persistTokenChanges = useStaticRef(() =>
    debounce(
      (
        loadedMapId: string,
        id: string,
        updates: any,
        localFetch: typeof fetch
      ) => {
        localFetch(`/map/${loadedMapId}/token/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...updates,
          }),
        });
      },
      100
    )
  );

  const updateToken = React.useCallback(
    ({ id, ...updates }) => {
      if (currentMap) {
        persistTokenChanges(currentMap.id, id, updates, fetch);
      }
    },
    [currentMap, persistTokenChanges, fetch]
  );

  const [toolbarPosition, setToolbarPosition] = useSpring(() => ({
    position: [12, window.innerHeight - 50 - 12] as [number, number],
    snapped: true,
  }));

  const [showItems, setShowItems] = React.useState(true);

  const isDraggingRef = React.useRef(false);

  const windowDimensions = useWindowDimensions();

  React.useEffect(() => {
    const position = toolbarPosition.position.get();
    const snapped = toolbarPosition.snapped.get();
    const y = position[1] + 50 + 12;
    if (y > windowDimensions.height || snapped) {
      setToolbarPosition({
        position: [position[0], windowDimensions.height - 50 - 12],
        snapped: true,
      });
    }
  }, [windowDimensions]);

  const handler = useGesture(
    {
      onDrag: (state) => {
        setToolbarPosition({
          position: state.movement,
          snapped: state.movement[1] === windowDimensions.height - 50 - 10,
          immediate: true,
        });
      },
      onClick: () => {
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          return;
        }
        setShowItems((showItems) => !showItems);
      },
    },
    {
      drag: {
        initial: () => toolbarPosition.position.get(),
        bounds: {
          left: 10,
          right: windowDimensions.width - 70 - 10,
          top: 10,
          bottom: windowDimensions.height - 50 - 10,
        },
        threshold: 5,
      },
    }
  );
  const noteWindowActions = useNoteWindowActions();
  return (
    <>
      <div
        style={{
          cursor: "grab",
          background: "black",
          height: "100vh",
        }}
      >
        <FlatContextProvider
          value={[
            [
              MarkAreaToolContext.Provider,
              {
                value: {
                  onMarkArea: ([x, y]) => {
                    socket.emit("mark area", { x, y });
                  },
                },
              },
            ] as ComponentWithPropsTuple<
              React.ComponentProps<typeof MarkAreaToolContext.Provider>
            >,
            [
              UpdateTokenContext.Provider,
              {
                value: (id, { x, y }) => updateToken({ id, x, y }),
              },
            ] as ComponentWithPropsTuple<
              React.ComponentProps<typeof UpdateTokenContext.Provider>
            >,
          ]}
        >
          {currentMap && mapImage ? (
            <MapView
              activeTool={PlayerMapTool}
              mapImage={mapImage}
              fogImage={fogImage}
              controlRef={controlRef}
              tokens={currentMap.tokens.filter(
                (token) => token.isVisibleForPlayers === true
              )}
              markedAreas={markedAreas}
              removeMarkedArea={(id) => {
                setMarkedAreas((markedAreas) =>
                  markedAreas.filter((area) => area.id !== id)
                );
              }}
              grid={
                currentMap.grid && currentMap.showGridToPlayers
                  ? currentMap.grid
                  : null
              }
              sharedContexts={[
                MarkAreaToolContext,
                NoteWindowActionsContext,
                ReactRelayContext,
                UpdateTokenContext,
              ]}
              fogOpacity={1}
            />
          ) : null}
        </FlatContextProvider>
      </div>
      {!showSplashScreen ? (
        isMapOnly ? null : (
          <>
            <ToolbarContainer
              style={{
                transform: to(
                  [toolbarPosition.position],
                  ([x, y]) => `translate(${x}px, ${y}px)`
                ),
              }}
            >
              <Toolbar horizontal>
                <Toolbar.Logo {...handler()} cursor="grab" />
                {showItems ? (
                  <React.Fragment>
                    <Toolbar.Group>
                      <Toolbar.Item isActive>
                        <Toolbar.Button
                          onClick={() => {
                            controlRef.current?.controls.center();
                          }}
                          onTouchStart={(ev) => {
                            ev.preventDefault();
                            controlRef.current?.controls.center();
                          }}
                        >
                          <Icons.Compass size={20} />
                          <Icons.Label>Center Map</Icons.Label>
                        </Toolbar.Button>
                      </Toolbar.Item>
                      <Toolbar.Item isActive>
                        <Toolbar.LongPressButton
                          onClick={() => {
                            controlRef.current?.controls.zoomIn();
                          }}
                          onLongPress={() => {
                            const interval = setInterval(() => {
                              controlRef.current?.controls.zoomIn();
                            }, 100);

                            return () => clearInterval(interval);
                          }}
                        >
                          <Icons.ZoomIn size={20} />
                          <Icons.Label>Zoom In</Icons.Label>
                        </Toolbar.LongPressButton>
                      </Toolbar.Item>
                      <Toolbar.Item isActive>
                        <Toolbar.LongPressButton
                          onClick={() => {
                            controlRef.current?.controls.zoomOut();
                          }}
                          onLongPress={() => {
                            const interval = setInterval(() => {
                              controlRef.current?.controls.zoomOut();
                            }, 100);

                            return () => clearInterval(interval);
                          }}
                        >
                          <Icons.ZoomOut size={20} />
                          <Icons.Label>Zoom Out</Icons.Label>
                        </Toolbar.LongPressButton>
                      </Toolbar.Item>
                      <Toolbar.Item isActive>
                        <Toolbar.LongPressButton
                          onClick={() => {
                            noteWindowActions.showNoteInWindow(
                              null,
                              "note-editor",
                              true
                            );
                          }}
                        >
                          <Icons.BookOpen size={20} />
                          <Icons.Label>Notes</Icons.Label>
                        </Toolbar.LongPressButton>
                      </Toolbar.Item>
                    </Toolbar.Group>
                  </React.Fragment>
                ) : null}
              </Toolbar>
            </ToolbarContainer>
          </>
        )
      ) : (
        <AbsoluteFullscreenContainer>
          <SplashScreen text="Ready." />
        </AbsoluteFullscreenContainer>
      )}
    </>
  );
};

const usePcPassword = () =>
  usePersistedState<string>("pcPassword", {
    encode: (value) => JSON.stringify(value),
    decode: (rawValue) => {
      if (typeof rawValue === "string") {
        try {
          const parsedValue = JSON.parse(rawValue);
          if (typeof parsedValue === "string") {
            return parsedValue;
          }
        } catch (e) {}
      }
      return "";
    },
  });

const AuthenticatedContent: React.FC<{
  pcPassword: string;
  localFetch: typeof fetch;
  isMapOnly: boolean;
}> = (props) => {
  const socket = useSocket();

  return (
    <AuthenticatedAppShell
      password={props.pcPassword}
      socket={socket}
      isMapOnly={props.isMapOnly}
      role="Player"
    >
      <PlayerMap
        fetch={props.localFetch}
        pcPassword={props.pcPassword}
        socket={socket}
        isMapOnly={props.isMapOnly}
      />
    </AuthenticatedAppShell>
  );
};

export const PlayerArea: React.FC<{
  password: string | null;
  isMapOnly: boolean;
}> = (props) => {
  const [pcPassword, setPcPassword] = usePcPassword();
  const initialPcPassword = React.useRef(pcPassword);
  let usedPassword = pcPassword;
  // the password in the query parameters has priority.
  if (pcPassword === initialPcPassword.current && props.password) {
    usedPassword = props.password;
  }

  const [mode, setMode] = React.useState("LOADING");

  const localFetch = React.useCallback(
    (input, init = {}) => {
      return fetch(buildApiUrl(input), {
        ...init,
        headers: {
          Authorization: usedPassword ? `Bearer ${usedPassword}` : undefined,
          ...init.headers,
        },
      }).then((res) => {
        if (res.status === 401) {
          console.error("Unauthenticated access.");
          setMode("AUTHENTICATE");
        }
        return res;
      });
    },
    [usedPassword]
  );

  useAsyncEffect(
    function* () {
      const result: any = yield localFetch("/auth").then((res) => res.json());
      if (!result.data.role) {
        setMode("AUTHENTICATE");
        return;
      }
      setMode("READY");
    },
    [localFetch]
  );

  if (mode === "LOADING") {
    return <SplashScreen text="Loading..." />;
  }

  if (mode === "AUTHENTICATE") {
    return (
      <AuthenticationScreen
        requiredRole="PC"
        fetch={localFetch}
        onAuthenticate={(password) => {
          setPcPassword(password);
        }}
      />
    );
  }

  if (mode === "READY") {
    return (
      <ToastProvider placement="bottom-right">
        <AuthenticatedContent
          localFetch={localFetch}
          pcPassword={usedPassword}
          isMapOnly={props.isMapOnly}
        />
      </ToastProvider>
    );
  }

  throw new Error("Invalid mode.");
};
