// Client-side Google Picker JS widget integration (no developer key required)

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

declare global {
  interface Window {
    gapi?: {
      load: (api: string, opts: { callback: () => void; onerror?: () => void }) => void;
    };
    google?: {
      picker?: {
        PickerBuilder: new () => {
          addView: (viewId: unknown) => any;
          enableFeature: (feature: unknown) => any;
          setOAuthToken: (token: string) => any;
          setCallback: (cb: (data: any) => void) => any;
          setOrigin: (origin: string) => any;
          build: () => { setVisible: (visible: boolean) => void };
        };
        ViewId: {
          DOCS: unknown;
          SPREADSHEETS: unknown;
          PRESENTATIONS: unknown;
          FORMS: unknown;
          FOLDERS: unknown;
        };
        Feature: {
          MULTISELECT_ENABLED: unknown;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
        };
      };
    };
  }
}

let gapiLoaderPromise: Promise<void> | null = null;

function ensurePickerLoaded(): Promise<void> {
  if (window.google?.picker) {
    return Promise.resolve();
  }
  if (gapiLoaderPromise) {
    return gapiLoaderPromise;
  }

  gapiLoaderPromise = new Promise<void>((resolve, reject) => {
    const loadPickerModule = () => {
      if (!window.gapi) {
        reject(new Error('Google API loader unavailable.'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Failed to load Google Picker library.')),
      });
    };

    if (window.gapi) {
      loadPickerModule();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = loadPickerModule;
    script.onerror = () => reject(new Error('Unable to load https://apis.google.com/js/api.js'));
    document.head.appendChild(script);
  });

  return gapiLoaderPromise;
}

export async function openGooglePicker(
  accessToken: string,
  options: { multiSelect?: boolean } = {}
): Promise<PickedDriveFile[]> {
  await ensurePickerLoaded();

  const pickerNs = window.google?.picker;
  if (!pickerNs) {
    throw new Error('Google Picker failed to initialize.');
  }

  return new Promise<PickedDriveFile[]>((resolve) => {
    const pickerOrigin =
      window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
        ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
        : window.location.origin;

    const builder = new pickerNs.PickerBuilder()
      .addView(pickerNs.ViewId.DOCS)
      .addView(pickerNs.ViewId.SPREADSHEETS)
      .addView(pickerNs.ViewId.PRESENTATIONS)
      .addView(pickerNs.ViewId.FORMS)
      .setOAuthToken(accessToken)
      .setOrigin(pickerOrigin)
      .setCallback((data: any) => {
        if (data?.action === pickerNs.Action.PICKED) {
          const docs = Array.isArray(data.docs) ? data.docs : [];
          resolve(
            docs.map((doc: any) => ({
              id: String(doc.id || ''),
              name: String(doc.name || 'Untitled File'),
              mimeType: String(doc.mimeType || 'application/octet-stream'),
              url: typeof doc.url === 'string' ? doc.url : '',
            }))
          );
        } else if (data?.action === pickerNs.Action.CANCEL) {
          resolve([]);
        }
      });

    if (options.multiSelect && pickerNs.Feature?.MULTISELECT_ENABLED) {
      builder.enableFeature(pickerNs.Feature.MULTISELECT_ENABLED);
    }

    const picker = builder.build();
    picker.setVisible(true);
  });
}
