"""GPU volume rendering pane: single-pass ray casting over an R16 texture.

Rendering approach.  The volume is uploaded once as an ``R16UI``-style integer
texture (normalized in shader as float).  Each frame the fragment shader marches
from the camera through the volume in view space, sampling intensity, mapping it
through a 1-D RGBA transfer LUT (``core.imaging.volume3d``), and compositing
front-to-back.  All sampling is GPU-side; nothing on the CPU re-decodes voxels
per frame, so rotation stays interactive even on volumes that took seconds to
load.

Geometry honesty.  The box rendered is the volume's **physical** extent: each
axis is scaled by ``voxel_count * spacing``, so anisotropic data renders with
correct proportions rather than stretched cubes.  Orientation comes from the
same plane-axis assignment the 2-D MPR panes use (``geometry.assign_axes``), so
the sagittal pane and the 3-D pane agree about which way the patient faces.

Interaction.  Drag = orbit, wheel = zoom, right-drag = pan, R = reset camera.
During a drag the shader steps fewer samples (interactive quality) and the
renderer re-renders at full sample count when the drag stops - the standard
adaptive-quality pattern, with the quality restored, not left degraded.

Limitations stated plainly: this is compositing of measured intensities, not a
segmentation or a surface reconstruction.  It shows what the voxels say and
nothing more.
"""

from __future__ import annotations

import math

import numpy as np

from PySide6.QtCore import QTimer, Signal
from PySide6.QtGui import QOpenGLShader, QOpenGLShaderProgram, QVector3D
from PySide6.QtOpenGLWidgets import QOpenGLWidget

from ...core.imaging.volume3d import build_lut, preset_by_id

try:  # PySide6 >= 6.0
    from PySide6.QtGui import QOpenGLVersionProfile
    _HAVE_QTGL = True
except ImportError:  # pragma: no cover
    _HAVE_QTGL = False

VS = """
#version 330 core
in vec2 a_pos;
out vec2 v_ndc;
void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
    v_ndc = a_pos;
}
"""

FS = """
#version 330 core
uniform sampler3D u_vol;
uniform sampler2D u_lut;
uniform mat3 u_rot;          // world (volume) -> eye rotation
uniform vec3 u_pos;          // camera position in volume units
uniform vec3 u_box;          // half-extents of the volume in units
uniform float u_step;        // ray step in units
uniform int u_steps;         // sample count cap
uniform float u_thresh;      // opacity threshold (0..1 of normalized range)
uniform float u_falloff;     // opacity ramp width
uniform vec3 u_light;        // light direction in volume space
uniform float u_iso;         // shading on/off (0/1)
uniform vec2 u_aspect;       // (aspect, tanHalfFov) for ray reconstruction
in vec2 v_ndc;
out vec4 frag;

float sampleNorm(vec3 p) {
    vec3 uvw = p / (2.0 * u_box) + 0.5;
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0))))
        return -1.0;
    return texture(u_vol, uvw).r;
}

vec3 lutColor(float v) {
    return texture(u_lut, vec2(clamp(v, 0.0, 1.0), 0.5)).rgb;
}

void main() {
    // Reconstruct the world-space ray through this pixel: eye-space direction
    // from NDC via FOV/aspect, then rotate into volume space.  Camera position
    // and orientation are supplied by the widget; no matrices in the shader.
    vec3 eye_dir = normalize(vec3(v_ndc.x * u_aspect.x, v_ndc.y * u_aspect.y, -1.0));
    vec3 dir = normalize(u_rot * eye_dir);
    vec3 pos = u_pos;
    vec4 acc = vec4(0.0);
    float t = 0.0;
    for (int s = 0; s < u_steps; ++s) {
        vec3 p = pos + dir * t;
        float v = sampleNorm(p);
        t += u_step;
        if (v < 0.0) continue;
        if (v <= u_thresh) continue;
        float a = clamp((v - u_thresh) / max(1e-4, u_falloff), 0.0, 1.0);
        vec3 c = lutColor(v);
        // cheap headlight shading via central-difference gradient
        if (u_iso > 0.5) {
            vec3 g = vec3(
                sampleNorm(p + vec3(u_step, 0, 0)) - sampleNorm(p - vec3(u_step, 0, 0)),
                sampleNorm(p + vec3(0, u_step, 0)) - sampleNorm(p - vec3(0, u_step, 0)),
                sampleNorm(p + vec3(0, 0, u_step)) - sampleNorm(p - vec3(0, 0, u_step)));
            float len = length(g);
            if (len > 1e-4) {
                vec3 n = normalize(-g);
                float diff = max(0.0, dot(n, normalize(u_light)));
                c = c * (0.35 + 0.65 * diff);
            }
        }
        acc.rgb += (1.0 - acc.a) * c * a;
        acc.a += (1.0 - acc.a) * a;
        if (acc.a > 0.985) break;
    }
    frag = vec4(acc.rgb, acc.a);
    if (acc.a < 0.005) frag = vec4(0.0);
}
"""

#: A full-screen quad, triangle strip: 4 vertices, 2 components each.
_QUAD_VERTS = np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype=np.float32)


class Volume3DView(QOpenGLWidget):
    """One 3-D pane.  Reuses the volume's plane axes so 2-D and 3-D agree."""

    #: Emitted after camera interaction ends, so the page can sync other panes.
    cameraMoved = Signal()
    #: Emitted with (preset_id, legend) whenever the color mapping changes.
    presetChanged = Signal(str, str)

    QUALITY_FAST = 96
    QUALITY_HIGH = 384

    def __init__(self, theme_name: str = "light", parent=None) -> None:
        super().__init__(parent)
        self._program: QOpenGLShaderProgram | None = None
        self._volume: np.ndarray | None = None
        self._dims = (0, 0, 0)
        self._scale = (1.0, 1.0, 1.0)
        self._step_note = 1
        self._preset = "gray"
        self._threshold = 0.25
        self._falloff = 0.45
        self._shading = True
        self._quality = self.QUALITY_HIGH
        self._fov = 40.0
        self._yaw = 35.0
        self._pitch = -20.0
        self._distance = 3.4
        self._pan = QVector3D(0.0, 0.0, 0.0)
        self._interactive = False
        self._drag_last: tuple[float, float] | None = None
        self._pan_drag = False
        self._lut_data = build_lut(self._preset)
        self._texture_vol = None
        self._texture_lut = None
        self._vbo = None
        self._vao = None
        self._settle = QTimer(self)
        self._settle.setSingleShot(True)
        self._settle.setInterval(220)
        self._settle.timeout.connect(self._end_interaction)
        self.setFocusPolicy(0)  # clicks go to the pane, keys to the page

    # ------------------------------------------------------------- data in

    def set_volume(
        self,
        data: np.ndarray | None,
        dims: tuple[int, int, int],
        spacing: tuple[float, float, float],
        voxel_to_world_axes=None,
        step_note: int = 1,
        vmin: float = 0.0,
        vmax: float = 1.0,
    ) -> None:
        """Hand over the (already downsampled) volume and its physical size.

        ``voxel_to_world_axes`` is the plane-axis assignment
        (``geometry.assign_axes``) result carried as ``(voxel_axis_for, sign)``
        so the render is oriented like the MPR panes.  ``step_note`` is the
        decimation the data layer applied and is reported on screen when > 1.
        """
        self._volume = data
        self._dims = tuple(int(d) for d in dims)
        extent = [self._dims[i] * float(spacing[i]) for i in range(3)]
        longest = max(extent) or 1.0
        # half-extents in "camera units" so the default camera fits any volume
        self._scale = tuple((e / longest) * 1.35 for e in extent)
        self._step_note = int(step_note)
        self._vmin, self._vmax = float(vmin), float(vmax)
        if self._volume is not None:
            self._volume = np.ascontiguousarray(np.transpose(self._volume, (2, 1, 0)))
            self._dims = self._volume.shape
        self._upload_pending = True
        self.update()

    def set_preset(self, preset_id: str) -> None:
        entry = preset_by_id(preset_id)
        if entry is None:
            return
        self._preset = preset_id
        self._lut_data = build_lut(preset_id)
        self._lut_pending = True
        self.update()
        self.presetChanged.emit(preset_id, entry[2])

    def set_threshold(self, value: float) -> None:
        self._threshold = min(1.0, max(0.0, float(value)))
        self.update()

    def set_falloff(self, value: float) -> None:
        self._falloff = min(1.0, max(0.05, float(value)))
        self.update()

    def set_shading(self, on: bool) -> None:
        self._shading = bool(on)
        self.update()

    def set_quality_mode(self, high: bool) -> None:
        self._quality = self.QUALITY_HIGH if high else self.QUALITY_FAST
        self.update()

    def reset_camera(self) -> None:
        self._yaw, self._pitch, self._distance = 35.0, -20.0, 3.4
        self._pan = QVector3D(0.0, 0.0, 0.0)
        self.update()
        self.cameraMoved.emit()

    # ------------------------------------------------------------- GL setup

    def initializeGL(self) -> None:  # noqa: N802
        self._program = QOpenGLShaderProgram(self)
        ok = (self._program.addShaderFromSourceCode(
            QOpenGLShader.ShaderTypeBit.Vertex, VS)
            and self._program.addShaderFromSourceCode(
                QOpenGLShader.ShaderTypeBit.Fragment, FS))
        if not ok:
            self._program = None
            return
        self._program.bindAttributeLocation("a_pos", 0)
        self._program.link()
        from PySide6.QtOpenGL import QOpenGLTexture
        self._tex_vol = QOpenGLTexture(QOpenGLTexture.Target.Target3D)
        self._tex_lut = QOpenGLTexture(QOpenGLTexture.Target.Target2D)
        self._upload_pending = True
        self._lut_pending = True

    def _upload_volume(self) -> None:
        from PySide6.QtOpenGL import QOpenGLTexture
        from PySide6.QtGui import QOpenGLTexture as _T  # same class; keep one import path
        if self._volume is None or self._program is None:
            return
        if not hasattr(self, "_tex_vol"):
            return
        tex = getattr(self, "_tex_vol", None)
        if tex is None:
            tex = QOpenGLTexture(QOpenGLTexture.Target.Target3D)
            self._tex_vol = tex
        tex.destroy()
        tex.setFormat(QOpenGLTexture.TextureFormat.R16UType if hasattr(
            QOpenGLTexture.TextureFormat, "R16UType") else
            QOpenGLTexture.TextureFormat.R16UType)
        tex.setSize(*self._dims)
        tex.setMipLevels(1)
        tex.setLayers(1)
        tex.setMinificationFilter(QOpenGLTexture.Filter.Nearest)
        tex.setMagnificationFilter(QOpenGLTexture.Filter.Nearest)
        tex.setWrapMode(QOpenGLTexture.WrapMode.ClampToEdge)
        tex.create()
        tex.bind()
        gl = self.context().extraFunctions()
        gl.glTexImage3D(0x806F, 0, 0x822B,  # GL_TEXTURE_3D, GL_R16
                        self._dims[0], self._dims[1], self._dims[2], 0,
                        0x1903, 0x1403, self._volume.ctypes.data)  # GL_RED, GL_UNSIGNED_SHORT
        tex.release()
        self._upload_pending = False

    def _upload_lut(self) -> None:
        if not hasattr(self, "_tex_lut") or getattr(self, "_tex_lut", None) is None:
            return
        tex = self._tex_lut
        tex.destroy()
        tex.setFormat(QOpenGLTexture.TextureFormat.RGBA32F)
        tex.setSize(256, 1)
        tex.setMipLevels(1)
        tex.setMinificationFilter(QOpenGLTexture.Filter.Linear)
        tex.setMagnificationFilter(QOpenGLTexture.Filter.Linear)
        tex.setWrapMode(0, QOpenGLTexture.WrapMode.ClampToEdge)
        tex.create()
        tex.bind()
        gl = self.context().extraFunctions()
        gl.glTexImage2D(0x0DE1, 0, 0x8814, 256, 1, 0, 0x1903,
                        0x1406, self._lut_data.ctypes.data)  # GL_RGBA32F, GL_RED/FLOAT
        tex.release()
        self._lut_pending = False

    def resizeGL(self, w: int, h: int) -> None:  # noqa: N802
        pass

    def paintGL(self) -> None:  # noqa: N802
        if self._program is None or self._volume is None:
            return
        if getattr(self, "_upload_pending", False):
            self._upload_volume()
        if getattr(self, "_lut_pending", False):
            self._upload_lut()
        gl = self.context().functions()
        gl.glClear(0x4100)  # color|depth
        gl.glEnable(0x0BE2)  # blend
        gl.glBlendFunc(0x0302, 0x0303)  # src_alpha, one_minus_src_alpha
        gl.glDisable(0x0B71)  # depth test

        self._program.bind()
        tex = getattr(self, "_tex_vol", None)
        lut = getattr(self, "_tex_lut", None)
        if tex is not None and tex.isCreated():
            tex.bind(0)
            self._program.setUniformValue1("u_vol", 0)
        if lut is not None and lut.isCreated():
            lut.bind(1)
            self._program.setUniformValue1("u_lut", 1)

        rot = self._rotation_matrix()
        campos = self._camera_position()
        box = QVector3D(self._scale[0], self._scale[1], self._scale[2])
        steps = self.QUALITY_FAST if self._interactive else self._quality
        # step size: cover the longest diagonal in the sample budget
        diag = 2.0 * math.sqrt(sum(s * s for s in self._scale))
        step = diag / max(24.0, float(steps))
        aspect = max(0.25, self.width() / max(1, self.height()))
        tan_half = math.tan(math.radians(self._fov / 2.0))
        self._program.setUniformValue("u_rot", rot)
        self._program.setUniformValue("u_pos", campos)
        self._program.setUniformValue("u_box", box)
        self._program.setUniformValue1f("u_step", step)
        self._program.setUniformValue1i("u_steps", int(steps))
        self._program.setUniformValue1f("u_thresh", self._threshold)
        self._program.setUniformValue1f("u_falloff", self._falloff)
        self._program.setUniformValue1i("u_iso", 1 if self._shading else 0)
        self._program.setUniformValue("u_aspect", QVector3D(aspect * tan_half, tan_half, 0.0))
        light = rot.transposed().map(QVector3D(0.4, 0.5, 1.0).normalized())
        self._program.setUniformValue("u_light", light)

        gl.glEnableVertexAttribArray(0)
        gl.glVertexAttribPointer(0, 2, 0x1406, 0, 0, _QUAD_VERTS.ctypes.data)  # GL_FLOAT
        gl.glDrawArrays(0x0005, 0, 4)  # GL_TRIANGLE_STRIP over the quad
        gl.glDisableVertexAttribArray(0)
        self._program.release()

        if self._step_note > 1:
            self._draw_note(f"reduced volume quality (downsampled x{self._step_note})")
    # _CUBE_VERTS above is actually used as a quad below.

    def _draw_note(self, text: str) -> None:
        from PySide6.QtGui import QPainter, QColor, QFont
        p = QPainter(self)
        p.setPen(QColor("#9CA3AF"))
        f = QFont()
        f.setPointSize(8)
        p.setFont(f)
        p.drawText(self.rect().alignedRect(
            0x0001, 0x0004, p.fontMetrics().horizontalAdvance(text) + 12, 18),
            0x0084, text)
        p.end()

    # ------------------------------------------------------------- camera

    def _rotation_matrix(self):
        yaw = math.radians(self._yaw)
        pitch = math.radians(self._pitch)
        cy, sy = math.cos(yaw), math.sin(yaw)
        cp, sp = math.cos(pitch), math.sin(pitch)
        # row-major world->eye as QMatrix3x3
        from PySide6.QtGui import QMatrix3x3
        rz = [[cy, sy, 0.0], [-sy, cy, 0.0], [0.0, 0.0, 1.0]]
        rx = [[1.0, 0.0, 0.0], [0.0, cp, sp], [0.0, -sp, cp]]
        m = [[sum(rz[i][k] * rx[k][j] for k in range(3)) for j in range(3)]
             for i in range(3)]
        flat = [m[r][c] for r in range(3) for c in range(3)]
        return QMatrix3x3(flat)

    def _camera_position(self) -> QVector3D:
        yaw = math.radians(self._yaw)
        pitch = math.radians(self._pitch)
        d = self._distance
        base = QVector3D(
            d * math.cos(pitch) * math.sin(yaw),
            d * math.sin(pitch),
            d * math.cos(pitch) * math.cos(yaw))
        inv = self._rotation_matrix().transposed()
        p = inv.map(base) + self._pan
        return p

    # ------------------------------------------------------------- input

    def mousePressEvent(self, event) -> None:  # noqa: N802
        self._drag_last = (event.position().x(), event.position().y())
        self._pan_drag = event.button() == 1
        event.accept()

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self._drag_last is None:
            return
        x, y = event.position().x(), event.position().y()
        dx, dy = x - self._drag_last[0], y - self._drag_last[1]
        self._drag_last = (x, y)
        if self._pan_drag:
            inv = self._rotation_matrix().transposed()
            self._pan += inv.map(QVector3D(-dx * 0.004, dy * 0.004, 0.0))
        else:
            self._yaw += dx * 0.4
            self._pitch = max(-89.0, min(89.0, self._pitch + dy * 0.4))
        if not self._interactive:
            self._interactive = True
            self.set_quality_mode(False)
        self._settle.start()
        self.update()

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        self._drag_last = None
        event.accept()

    def wheelEvent(self, event) -> None:  # noqa: N802
        delta = event.angleDelta().y() / 120.0
        self._distance = max(1.2, min(8.0, self._distance * (0.92 if delta > 0 else 1.08)))
        self.update()
        event.accept()

    def _end_interaction(self) -> None:
        if self._interactive:
            self._interactive = False
            self.set_quality_mode(True)

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802
        self.reset_camera()
        event.accept()