import { expect, test, type Locator, type Page } from '@playwright/test';

async function screenPointAtPathMidpoint(pathLocator: Locator) {
  return pathLocator.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) {
      throw new Error('Link does not have a screen transform.');
    }
    const point = path
      .getPointAtLength(path.getTotalLength() / 2)
      .matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
}

async function selectLink(page: Page, link: Locator) {
  const clickPoint = await screenPointAtPathMidpoint(
    link.locator('.react-flow__edge-interaction'),
  );
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(link).toHaveClass(/selected/);
}

async function cameraRequestCount(page: Page) {
  return page.evaluate(() =>
    Number(Reflect.get(window, '__videoBrainCameraRequestCount') ?? 0),
  );
}

async function connectHandles(source: Locator, target: Locator, page: Page) {
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();

  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2,
    sourceBounds!.y + sourceBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBounds!.x + targetBounds!.width / 2,
    targetBounds!.y + targetBounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

async function renderedColorSignal(page: Page) {
  return page.locator('canvas.preview-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl || canvas.width < 1 || canvas.height < 1) {
      return 0;
    }

    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }),
    );

    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let maximumRgb = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      maximumRgb = Math.max(
        maximumRgb,
        pixels[index] ?? 0,
        pixels[index + 1] ?? 0,
        pixels[index + 2] ?? 0,
      );
    }
    return maximumRgb;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices?.getUserMedia.bind(mediaDevices);
    Reflect.set(window, '__videoBrainCameraRequestCount', 0);
    if (!mediaDevices || !originalGetUserMedia) {
      return;
    }
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: (constraints: MediaStreamConstraints) => {
        if (constraints.video) {
          const current = Number(
            Reflect.get(window, '__videoBrainCameraRequestCount') ?? 0,
          );
          Reflect.set(window, '__videoBrainCameraRequestCount', current + 1);
        }
        return originalGetUserMedia(constraints);
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Graph healthy')).toBeVisible();
});

test('boots a live GPU composition without permissions', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Live output' })).toBeVisible();
  await expect(page.getByText('running', { exact: true })).toBeVisible();
  const canvas = page.locator('canvas.preview-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame')))
    .toBeGreaterThan(1);
});

test('starts blank and example graphs from the New patch menu', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'New patch' });
  await page
    .locator('article[aria-label="Flow Field node"] .operator-node-header')
    .click();
  await expect(
    page.getByRole('complementary', { name: 'Flow Field inspector' }),
  ).toBeVisible();

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'New patch starters' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(18);
  await expect(
    menu.getByRole('menuitem', { name: /Blank Canvas/ }),
  ).toBeFocused();
  await expect(
    menu.getByRole('menuitem', { name: /Beat-Synced Color/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Spiral Feedback Lab/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Control Math/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Smooth Pointer/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Transform Playground/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Mask & Composite Lab/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Beat Switcher/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Live Cut Lab/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Audio Soft Focus/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Audio Beat Pulse/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Camera Dream/ }),
  ).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Import project' }),
  ).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  await trigger.click();

  let confirmation = '';
  page.once('dialog', (dialog) => {
    confirmation = dialog.message();
    void dialog.dismiss();
  });
  await menu.getByRole('menuitem', { name: /Blank Canvas/ }).click();
  expect(confirmation).toContain('Blank Canvas');
  expect(confirmation).toContain(
    'live inputs and model connections will stop and must be restarted',
  );
  await expect(page.getByText(/15 nodes/).first()).toBeVisible();

  await trigger.click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page
    .getByRole('menuitem', { name: /Beat-Synced Color/ })
    .click();

  await expect(page.getByText(/7 nodes/).first()).toBeVisible();
  await expect(page.getByText(/8 links/).first()).toBeVisible();
  await expect(page.getByText('Nothing selected')).toBeVisible();
  await expect(page.getByText('Beat-Synced Color loaded.')).toBeVisible();
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute(
    'data-rendered',
    'true',
  );

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/15 nodes/).first()).toBeVisible();

  await trigger.click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('menuitem', { name: /Blank Canvas/ }).click();
  await expect(page.getByText(/0 nodes/).first()).toBeVisible();
  await expect(page.getByText(/0 links/).first()).toBeVisible();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('videobrain.project');
        if (!raw) {
          return -1;
        }
        const saved = JSON.parse(raw) as {
          document?: { nodes?: unknown[] };
        };
        return saved.document?.nodes?.length ?? -1;
      }),
    )
    .toBe(0);

  await page.reload();
  await expect(page.getByText(/0 nodes/).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const mobileMenuBounds = await menu.boundingBox();
  expect(mobileMenuBounds).not.toBeNull();
  expect(mobileMenuBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    (mobileMenuBounds?.x ?? 0) + (mobileMenuBounds?.width ?? 391),
  ).toBeLessThanOrEqual(390);
});

test('runs every teaching node inside a visible starter graph', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'New patch' });
  const canvas = page.locator('canvas.preview-canvas');

  const loadStarter = async (title: string) => {
    await trigger.click();
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.getByRole('menuitem', { name: new RegExp(title) }).click();
    await expect(page.getByText(`${title} loaded.`)).toBeVisible();
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('held', { exact: true })).toBeVisible();
    await expect
      .poll(() => renderedColorSignal(page), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('running', { exact: true })).toBeVisible();
  };

  await loadStarter('Control Math');
  await expect(
    page
      .locator('article[aria-label="Constant node"]')
      .getByRole('slider', { name: 'Constant Value' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Math node"]')
      .getByRole('slider', { name: 'Math A' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Map Range node"]')
      .getByRole('slider', { name: 'Map Range Output max' }),
  ).toBeVisible();

  await loadStarter('Smooth Pointer');
  await expect(
    page
      .locator('article[aria-label="Smooth node"]')
      .getByRole('slider', { name: 'Smooth Rise (s)' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Transform 2D node"]')
      .getByRole('slider', { name: 'Transform 2D X' }),
  ).toBeVisible();

  await loadStarter('Transform Playground');
  await expect(
    page
      .locator('article[aria-label="Transform 2D node"]')
      .getByRole('slider', { name: 'Transform 2D Rotation' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="XY Pad node"]')
      .getByRole('button', { name: 'XY Pad Position' }),
  ).toBeVisible();

  await loadStarter('Mask & Composite Lab');
  await expect(
    page
      .locator('article[aria-label="Solid Color node"]')
      .getByRole('slider', { name: 'Solid Color Red' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Threshold node"]')
      .getByRole('slider', { name: 'Threshold Level' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Mask node"]')
      .getByRole('slider', { name: 'Mask Amount' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Composite node"]')
      .getByRole('slider', { name: 'Composite Opacity' }),
  ).toBeVisible();

  await loadStarter('Beat Switcher');
  await expect(
    page
      .locator('article[aria-label="Frame Switch node"]')
      .getByRole('slider', { name: 'Frame Switch Index' }),
  ).toBeVisible();

  await loadStarter('Audio Soft Focus');
  await expect(
    page
      .locator('article[aria-label="Blur node"]')
      .getByRole('slider', { name: 'Blur Radius (px)' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article[aria-label="Audio Level node"]')
      .getByRole('button', { name: 'Start mic' }),
  ).toBeVisible();

  await loadStarter('Audio Beat Pulse');
  const spectrum = page.locator('article[aria-label="Audio Spectrum node"]');
  const audioTrigger = page.locator('article[aria-label="Audio Trigger node"]');
  const audioBeat = page.locator('article[aria-label="Audio Beat Clock node"]');
  await expect(
    spectrum.getByRole('slider', { name: 'Audio Spectrum Gain' }),
  ).toHaveValue('2.4');
  await expect(
    spectrum.getByRole('button', { name: 'Start mic' }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('article[aria-label="Audio Level node"]')
      .getByRole('button', { name: 'Start mic' }),
  ).toBeVisible();
  await expect(
    audioTrigger.getByRole('slider', { name: 'Audio Trigger Threshold' }),
  ).toHaveValue('0.14');
  await expect(
    audioTrigger.getByRole('slider', { name: 'Audio Trigger Hold (s)' }),
  ).toHaveValue('0.14');
  await expect(
    audioBeat.getByRole('slider', { name: 'Audio Beat Clock Resting BPM' }),
  ).toHaveValue('120');
  await expect(
    audioBeat.getByRole('slider', { name: 'Audio Beat Clock Max BPM' }),
  ).toHaveValue('170');

  await loadStarter('Live Cut Lab');
  const selector = page.locator('article[aria-label="Auto Selector node"]');
  const strobe = page.locator('article[aria-label="Strobe node"]');
  await expect(
    selector.getByRole('slider', {
      name: 'Auto Selector Interval (s)',
    }),
  ).toHaveValue('1.5');
  await expect(
    selector.getByRole('slider', { name: 'Auto Selector Count' }),
  ).toHaveValue('4');
  await expect(
    selector.getByRole('combobox', { name: 'Auto Selector Order' }),
  ).toHaveValue('shuffleBag');
  await expect(
    selector.getByRole('slider', { name: 'Auto Selector Seed' }),
  ).toHaveValue('23');
  await expect(
    strobe.getByRole('slider', { name: 'Strobe Rate (Hz)' }),
  ).toHaveValue('0.67');
  await expect(
    strobe.getByRole('slider', { name: 'Strobe Open fraction' }),
  ).toHaveValue('0.82');
  await expect(
    strobe.getByRole('slider', { name: 'Strobe Amount' }),
  ).toHaveValue('0.55');
  await expect(
    strobe.getByRole('combobox', { name: 'Strobe Closed' }),
  ).toHaveValue('invert');

  await loadStarter('Spiral Feedback Lab');
  const spiral = page.locator('article[aria-label="Spiral Feedback node"]');
  await expect(
    spiral.getByRole('slider', {
      name: 'Spiral Feedback Feedback (1 s)',
    }),
  ).toHaveValue('0.82');
  await expect(
    spiral.getByRole('slider', {
      name: 'Spiral Feedback Rotation (°/s)',
    }),
  ).toHaveValue('42');
  await expect(
    spiral.getByRole('slider', { name: 'Spiral Feedback Zoom (×/s)' }),
  ).toHaveValue('1.16');
  await expect(
    spiral.getByRole('button', { name: 'Spiral Feedback Center' }),
  ).toBeVisible();
  await expect(spiral).toContainText('X 0.46 · Y 0.54');

  await page.getByTitle('Return to frame zero').click();
  await expect(page.getByText('Playback returned to frame zero.')).toBeVisible();
});

test('stops active device sessions before replacing a patch', async ({
  page,
}) => {
  await page
    .locator('article[aria-label="Audio Level node"] .operator-node-header')
    .click();
  let inspector = page.getByRole('complementary', {
    name: 'Audio Level inspector',
  });
  await inspector.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(
    inspector.getByRole('button', { name: 'Stop microphone' }),
  ).toBeVisible();

  await page.getByTitle('Add Video Input').click();
  inspector = page.getByRole('complementary', {
    name: 'Video Input inspector',
  });
  await inspector.getByRole('button', { name: 'Enable camera' }).click();
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'New patch' }).click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('menuitem', { name: /Camera Dream/ }).click();
  await expect(page.getByText(/8 nodes/).first()).toBeVisible();
  await expect
    .poll(() =>
      page.locator('video.video-input-element').evaluate(
        (video) => (video as HTMLVideoElement).srcObject === null,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Undo' }).click();
  await page
    .locator('article[aria-label="Audio Level node"] .operator-node-header')
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Audio Level inspector' })
      .getByRole('button', { name: 'Enable microphone' }),
  ).toBeVisible();

  await page
    .locator('article[aria-label="Video Input node"] .operator-node-header')
    .last()
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Video Input inspector' })
      .getByText('Camera off', { exact: true }),
  ).toBeVisible();
});

test('switches monitor output between display sync and fixed frame rates', async ({
  page,
}) => {
  const monitor = page.getByRole('region', { name: 'Live output' });
  const pacing = monitor.getByRole('combobox', {
    name: 'Monitor frame pacing',
  });
  const canvas = monitor.locator('canvas.preview-canvas');

  await expect(pacing).toHaveValue('display');
  await expect(pacing.getByRole('option', { name: 'Display sync' })).toBeAttached();
  await expect(pacing.getByRole('option', { name: '60 fps' })).toBeAttached();
  await expect(pacing.getByRole('option', { name: '30 fps' })).toBeAttached();
  await expect(canvas).toHaveAttribute('data-frame-pacing', 'display');

  const frameBeforeFixedRate = Number(await canvas.getAttribute('data-frame'));
  await pacing.selectOption('30-fps');
  await expect(pacing).toHaveValue('30-fps');
  await expect(canvas).toHaveAttribute('data-frame-pacing', '30-fps');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frame')))
    .toBeGreaterThan(frameBeforeFixedRate);

  await pacing.selectOption('60-fps');
  await expect(canvas).toHaveAttribute('data-frame-pacing', '60-fps');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pacing).toBeVisible();
  const newPatchTrigger = page.getByRole('button', { name: 'New patch' });
  await expect(newPatchTrigger).toBeVisible();
  await newPatchTrigger.click();
  const newPatchMenu = page.getByRole('menu', { name: 'New patch starters' });
  await expect(newPatchMenu).toBeVisible();
  expect(
    await newPatchMenu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= window.innerWidth &&
        bounds.bottom <= window.innerHeight
      );
    }),
  ).toBe(true);
  await page.keyboard.press('Escape');
  expect(
    await monitor.locator('.preview-header').evaluate(
      (header) => header.scrollWidth <= header.clientWidth,
    ),
  ).toBe(true);
});

test('keeps inline values visible and edits the XY pad as one undo gesture', async ({
  page,
}) => {
  const timeNode = page.locator(
    'article[aria-label="Transport Time node"]',
  );
  await expect(timeNode).not.toHaveClass(/selected/);
  await expect(
    timeNode.getByRole('slider', { name: 'Transport Time Speed' }),
  ).toBeVisible();
  await expect(
    timeNode.getByRole('slider', { name: 'Transport Time Offset' }),
  ).toBeVisible();

  const xyNode = page.locator('article[aria-label="XY Pad node"]');
  const pad = xyNode.getByRole('button', { name: 'XY Pad Position' });
  await expect(pad).toBeVisible();
  await expect(xyNode).toContainText('X 0.50 · Y 0.50');
  const bounds = await pad.boundingBox();
  expect(bounds).not.toBeNull();

  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.8,
    bounds!.y + bounds!.height * 0.2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(xyNode).toContainText('X 0.80 · Y 0.80');
  await expect(
    page.getByRole('complementary', { name: 'XY Pad inspector' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(xyNode).toContainText('X 0.50 · Y 0.50');
});

test('starts camera input only after opt-in and renders its live frame', async ({
  page,
}) => {
  await expect.poll(() => cameraRequestCount(page)).toBe(0);

  await page.getByTitle('Add Video Input').click();
  await expect(page.getByText(/16 nodes/).first()).toBeVisible();
  const inspector = page.getByRole('complementary', {
    name: 'Video Input inspector',
  });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('Camera off', { exact: true })).toBeVisible();
  await expect.poll(() => cameraRequestCount(page)).toBe(0);

  const videoInputNode = page
    .locator('article[aria-label="Video Input node"]')
    .last();
  const inlineCamera = videoInputNode.getByRole('combobox', {
    name: 'Video Input Camera',
  });
  await inlineCamera.selectOption('environment');
  await expect(inspector.getByLabel('Camera')).toHaveValue('environment');
  await expect.poll(() => cameraRequestCount(page)).toBe(0);

  await videoInputNode.getByRole('button', { name: 'Start camera' }).click();
  await expect.poll(() => cameraRequestCount(page)).toBe(1);
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();
  await expect(
    videoInputNode.getByRole('button', { name: 'Stop camera' }),
  ).toBeVisible();
  await expect(
    page.locator('.preview-hud').getByText('camera', { exact: true }),
  ).toBeVisible();

  await inlineCamera.selectOption('user');
  await expect.poll(() => cameraRequestCount(page)).toBe(2);
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();
  await expect(inspector.getByLabel('Camera')).toHaveValue('user');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inlineCamera).toHaveValue('environment');
  await expect(inspector.getByLabel('Camera')).toHaveValue('environment');
  await expect.poll(() => cameraRequestCount(page)).toBe(3);
  await expect(inspector.getByText('Camera live', { exact: true })).toBeVisible();

  const links = page.locator('[data-testid^="rf__edge-"]');
  await expect(links).toHaveCount(18);
  const initialLinkCount = await links.count();
  const previousDisplayLink = page.getByTestId('rf__edge-model-display');
  await selectLink(page, previousDisplayLink);
  await page.keyboard.press('Delete');
  await expect(previousDisplayLink).toHaveCount(0);

  const source = videoInputNode.getByLabel('Frame output, frame.rgba');
  const target = page
    .locator('article[aria-label="Display node"]')
    .getByLabel('Source input, frame.rgba');
  await connectHandles(source, target, page);
  await expect(links).toHaveCount(initialLinkCount);
  await expect(page.locator('.preview-hud')).toContainText('2 passes');
  await expect(page.getByText('Graph healthy')).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('held', { exact: true })).toBeVisible();
  await expect
    .poll(() => renderedColorSignal(page), { timeout: 10_000 })
    .toBeGreaterThan(8);

  await videoInputNode.locator('.operator-node-header').click();
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Stop camera' }).click();
  await expect(inspector.getByText('Camera off', { exact: true })).toBeVisible();
  await expect(
    page.locator('.preview-hud').getByText('camera', { exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => cameraRequestCount(page)).toBe(3);
  await expect
    .poll(() =>
      page.locator('video.video-input-element').evaluate(
        (video) => (video as HTMLVideoElement).srcObject === null,
      ),
    )
    .toBe(true);
  await expect(page.locator('canvas.preview-canvas')).toHaveAttribute(
    'data-rendered',
    'true',
  );
});

test('starts audio analysis from the node and shows its control output', async ({
  page,
}) => {
  const audioNode = page.locator('article[aria-label="Audio Level node"]');
  const meter = audioNode.getByRole('meter', {
    name: 'Demo control output level',
  });

  await expect(audioNode.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(meter).toBeVisible();
  await audioNode.getByRole('button', { name: 'Start mic' }).click();

  await expect(audioNode.getByText('MIC LIVE', { exact: true })).toBeVisible();
  await expect(
    audioNode.getByRole('meter', { name: 'Microphone control output level' }),
  ).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Audio Level inspector' }),
  ).toContainText('Control only — no sound output.');

  await audioNode.getByRole('button', { name: 'Stop mic' }).click();
  await expect(audioNode.getByText('DEMO', { exact: true })).toBeVisible();
});

test('opens in-app help with current nodes, I/O guidance, and contribution link', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Help & about' }).click();
  const dialog = page.getByRole('dialog', { name: 'Explore the Signal Graph' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Four signal types, one graph')).toBeVisible();
  await expect(dialog.getByText('Video Input', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('heading', {
      name: 'Inputs, outputs, and device access',
    }),
  ).toBeVisible();
  await expect(dialog).toContainText('MIDI');
  await expect(dialog).toContainText('OSC');
  await expect(dialog).toContainText('explicit action');
  await expect(dialog).toContainText('Photosensitivity warning');
  await expect(dialog).toContainText('connected Phase signal overrides Rate');
  await expect(dialog).toContainText('about 0.67 cycles per second');
  await expect(
    dialog.getByRole('link', { name: /Contribute on GitHub/ }),
  ).toHaveAttribute('href', 'https://github.com/blechdom/videobrain');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('adds, inspects, edits, and undoes a node', async ({ page }) => {
  await page.getByTitle('Add Flow Field').click();
  await expect(page.getByText(/16 nodes/).first()).toBeVisible();

  const addedNode = page.locator('article[aria-label="Flow Field node"]').last();
  await expect(page.getByRole('complementary', { name: 'Flow Field inspector' })).toBeVisible();

  const inlineScale = addedNode.getByRole('slider', { name: 'Flow Field Scale' });
  const inspectorScale = page
    .locator('.parameter-row')
    .filter({ hasText: 'Scale' })
    .locator('input');
  const before = Number(await inlineScale.inputValue());
  const nodePosition = await addedNode.evaluate(
    (element) => element.parentElement?.getAttribute('style'),
  );
  await inlineScale.focus();
  await inlineScale.press('ArrowRight');
  await expect
    .poll(async () => Number(await inlineScale.inputValue()))
    .toBeGreaterThan(before);
  await expect(inspectorScale).toHaveValue(await inlineScale.inputValue());
  await expect
    .poll(() =>
      addedNode.evaluate((element) => element.parentElement?.getAttribute('style')),
    )
    .toBe(nodePosition);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inlineScale).toHaveValue(String(before));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/15 nodes/).first()).toBeVisible();
});

test('opens searchable node creation from the keyboard', async ({ page }) => {
  await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: 'Add a node' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search nodes' }).fill('trail');
  await expect(dialog.getByRole('button', { name: /Trails/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('selects and deletes a link from the graph', async ({ page }) => {
  const links = page.locator('[data-testid^="rf__edge-"]');
  const initialLinkCount = await links.count();
  expect(initialLinkCount).toBeGreaterThan(0);

  const link = page.getByTestId('rf__edge-model-display');
  await selectLink(page, link);

  await page.keyboard.press('Delete');
  await expect(links).toHaveCount(initialLinkCount - 1);
  await expect(page.locator('.graph-overlay')).toContainText(
    `${initialLinkCount - 1} links`,
  );
});

test('rewires a selected link to a compatible output', async ({ page }) => {
  const initialLinkCount = await page.locator('[data-testid^="rf__edge-"]').count();
  const link = page.getByTestId('rf__edge-field-blend');
  await selectLink(page, link);

  const updater = link.locator('.react-flow__edgeupdater-source');
  const destination = page
    .locator('article[aria-label="Cells node"]')
    .getByLabel('Frame output, frame.rgba');
  const updaterBounds = await updater.boundingBox();
  const destinationBounds = await destination.boundingBox();
  expect(updaterBounds).not.toBeNull();
  expect(destinationBounds).not.toBeNull();

  await page.mouse.move(
    updaterBounds!.x + updaterBounds!.width / 2,
    updaterBounds!.y + updaterBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    destinationBounds!.x + destinationBounds!.width / 2,
    destinationBounds!.y + destinationBounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect(link).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Edge from cells to blend', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="rf__edge-"]')).toHaveCount(initialLinkCount);
  await expect(page.getByText('Graph healthy')).toBeVisible();
});

test('explains why an incompatible link drop was rejected', async ({ page }) => {
  const source = page
    .locator('article[aria-label="Transport Time node"]')
    .getByLabel('Time output, control.f32');
  const target = page
    .locator('article[aria-label="Warp node"]')
    .getByLabel('Source input, frame.rgba');
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();

  await page.mouse.move(
    sourceBounds!.x + sourceBounds!.width / 2,
    sourceBounds!.y + sourceBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBounds!.x + targetBounds!.width / 2,
    targetBounds!.y + targetBounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect(page.getByRole('alert')).toContainText(
    'Cannot connect control.f32 to frame.rgba.',
  );
});

test('autosaves project changes across reloads', async ({ page }) => {
  await page.getByTitle('Add Audio Level').click();
  await page.reload();
  await expect(page.getByText(/16 nodes/).first()).toBeVisible();
  await expect(page.getByText('Graph healthy')).toBeVisible();
  await expect(page.getByText('Signal Graph / saved')).toBeVisible();
});
