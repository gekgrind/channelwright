/* @ds-bundle: {"format":4,"namespace":"EntrepreneuriaDesignSystem_739023","components":[{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Kbd","sourcePath":"components/display/Kbd.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Progress","sourcePath":"components/feedback/Progress.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Accordion","sourcePath":"components/navigation/Accordion.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Dialog","sourcePath":"components/overlay/Dialog.jsx"}],"sourceHashes":{"components/display/Avatar.jsx":"cf42d3d79eca","components/display/Card.jsx":"6d8aa129c2a6","components/display/Kbd.jsx":"649dbf8f7c37","components/feedback/Alert.jsx":"0635f7ae3b4c","components/feedback/Badge.jsx":"0a985a989da8","components/feedback/Progress.jsx":"aaba9d4759fe","components/feedback/Tooltip.jsx":"97e28e414d91","components/forms/Button.jsx":"5a71f009e0eb","components/forms/Checkbox.jsx":"46ece0c54d4a","components/forms/Input.jsx":"02eba9d0528b","components/forms/Switch.jsx":"6aae9b9311b5","components/navigation/Accordion.jsx":"8efb0b1deb9c","components/navigation/Tabs.jsx":"32d648bf9fef","components/overlay/Dialog.jsx":"6e9492656c4c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.EntrepreneuriaDesignSystem_739023 = window.EntrepreneuriaDesignSystem_739023 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/display/Avatar.jsx
try { (() => {
/** Circular avatar with image or initials fallback. */
function Avatar({
  src,
  name = '',
  size = 40,
  style
}) {
  const initials = name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      overflow: 'hidden',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--brand-blue)',
      color: 'var(--white)',
      fontFamily: 'var(--font-body)',
      fontWeight: 'var(--weight-semibold)',
      fontSize: size * 0.38,
      flexShrink: 0,
      ...style
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
const {
  useState
} = React;
/** The homepage/product card surface — translucent glass with a hover border brighten. variant: glass | premium | floating. */
function Card({
  variant = 'glass',
  interactive = false,
  children,
  style
}) {
  const [hover, setHover] = useState(false);
  const base = {
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    fontFamily: 'var(--font-body)',
    color: 'var(--text-primary)',
    transition: 'all var(--duration-base) ease'
  };
  const variants = {
    glass: {
      background: hover && interactive ? 'var(--surface-card-hover)' : 'var(--surface-card)',
      border: `1px solid ${hover && interactive ? 'var(--border-strong)' : 'var(--border-subtle)'}`
    },
    premium: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      boxShadow: hover && interactive ? 'var(--shadow-sm-hover)' : 'var(--shadow-sm)'
    },
    floating: {
      background: 'var(--surface-card)',
      border: 'none',
      boxShadow: hover && interactive ? 'var(--shadow-md-hover)' : 'var(--shadow-md)'
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Kbd.jsx
try { (() => {
/** Small keycap chip, for keyboard shortcuts. */
function Kbd({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("kbd", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 20,
      height: 20,
      padding: '0 6px',
      borderRadius: 4,
      background: 'rgba(255,255,255,.1)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-label)',
      fontSize: 11,
      border: '1px solid var(--border-subtle)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Kbd });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Kbd.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
/** Inline alert banner. variant: default | destructive. */
function Alert({
  variant = 'default',
  title,
  children,
  style
}) {
  const destructive = variant === 'destructive';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '14px 16px',
      borderRadius: 'var(--radius-sm)',
      background: destructive ? 'rgba(228,0,20,.08)' : 'var(--surface-card)',
      border: `1px solid ${destructive ? 'rgba(228,0,20,.35)' : 'var(--border-subtle)'}`,
      color: destructive ? '#ff8a94' : 'var(--text-primary)',
      fontFamily: 'var(--font-body)',
      ...style
    }
  }, title ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 'var(--weight-semibold)',
      fontSize: 14
    }
  }, title) : null, children ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.6,
      color: destructive ? 'rgba(255,138,148,.85)' : 'var(--text-secondary)'
    }
  }, children) : null);
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
const tones = {
  live: {
    bg: 'transparent',
    border: '1px solid var(--brand-accent)',
    color: 'var(--brand-accent)'
  },
  waitlist: {
    bg: 'transparent',
    border: '1px solid rgba(255,255,255,.25)',
    color: 'var(--text-secondary)'
  },
  accent: {
    bg: 'var(--brand-accent)',
    border: 'none',
    color: 'var(--text-on-accent)'
  },
  orange: {
    bg: 'var(--brand-orange)',
    border: 'none',
    color: 'var(--white)'
  }
};

/** Small rounded status/label pill. tone: live | waitlist | accent | orange. */
function Badge({
  tone = 'waitlist',
  children,
  style
}) {
  const t = tones[tone];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 12px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-label)',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: '.14em',
      fontWeight: 'var(--weight-regular)',
      background: t.bg,
      border: t.border,
      color: t.color,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Progress.jsx
try { (() => {
/** Thin progress bar — cyan fill on a translucent-cyan track. */
function Progress({
  value = 0,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 8,
      width: '100%',
      borderRadius: 'var(--radius-pill)',
      background: 'rgba(0,212,255,.2)',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      width: `${Math.max(0, Math.min(100, value))}%`,
      background: 'var(--brand-accent)',
      borderRadius: 'var(--radius-pill)',
      transition: 'width var(--duration-base) ease'
    }
  }));
}
Object.assign(__ds_scope, { Progress });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Progress.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
const {
  useState
} = React;
/** Icon/text hint that appears above its trigger on hover. */
function Tooltip({
  label,
  children,
  style
}) {
  const [open, setOpen] = useState(false);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false)
  }, children, open ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 8,
      background: 'var(--white)',
      color: 'var(--brand-navy)',
      fontFamily: 'var(--font-body)',
      fontSize: 12,
      padding: '6px 10px',
      borderRadius: 6,
      whiteSpace: 'nowrap',
      fontWeight: 'var(--weight-medium)',
      boxShadow: 'var(--shadow-md)',
      ...style
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
const base = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontFamily: 'var(--font-body)',
  fontWeight: 'var(--weight-medium)',
  fontSize: 'var(--text-button)',
  lineHeight: 'var(--text-button-lh)',
  border: 'none',
  cursor: 'pointer',
  transition: `all var(--duration-fast) ease`,
  whiteSpace: 'nowrap',
  textDecoration: 'none'
};
const variants = {
  primary: {
    background: 'var(--brand-orange)',
    color: 'var(--white)',
    borderRadius: 'var(--radius-pill)'
  },
  accent: {
    background: 'var(--brand-accent)',
    color: 'var(--text-on-accent)',
    borderRadius: 'var(--radius-pill)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--white)',
    borderRadius: 'var(--radius-pill)'
  },
  icon: {
    background: 'rgba(255,255,255,.1)',
    color: 'var(--white)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(79,124,167,.2)'
  }
};
const hoverStyles = {
  primary: {
    background: '#b96a24',
    boxShadow: '0 0 12px rgba(0,212,255,.2)'
  },
  accent: {
    background: 'var(--brand-accent-strong)',
    boxShadow: '0 0 16px rgba(0,212,255,.4)'
  },
  ghost: {
    background: 'rgba(255,255,255,.1)',
    color: 'var(--brand-accent)'
  },
  icon: {
    background: 'rgba(255,255,255,.15)',
    borderColor: 'rgba(0,212,255,.3)'
  }
};
const sizes = {
  default: {
    height: 56,
    padding: '8px 28px'
  },
  sm: {
    height: 44,
    padding: '8px 20px',
    fontSize: 13
  },
  icon: {
    height: 44,
    width: 44,
    padding: 0
  }
};

/** Pill-shaped brand button. variant: primary | accent | ghost | icon. */
function Button({
  variant = 'primary',
  size = 'default',
  disabled = false,
  children,
  style,
  ...props
}) {
  const [hover, setHover] = useState(false);
  const effSize = variant === 'icon' ? 'icon' : size;
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...variants[variant],
      ...sizes[effSize],
      ...(hover && !disabled ? hoverStyles[variant] : {}),
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/** Square checkbox — checked state fills cyan. */
function Checkbox({
  checked: checkedProp,
  defaultChecked = false,
  onChange,
  style,
  ...props
}) {
  const isControlled = checkedProp !== undefined;
  const [internal, setInternal] = useState(defaultChecked);
  const checked = isControlled ? checkedProp : internal;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "checkbox",
    "aria-checked": checked,
    onClick: e => {
      if (!isControlled) setInternal(v => !v);
      onChange?.(!checked, e);
    },
    style: {
      width: 18,
      height: 18,
      borderRadius: 4,
      cursor: 'pointer',
      border: `1px solid ${checked ? 'var(--brand-accent)' : 'var(--border-medium)'}`,
      background: checked ? 'var(--brand-accent)' : 'rgba(255,255,255,.08)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      transition: 'all var(--duration-fast) ease',
      ...style
    }
  }, props), checked ? /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--text-on-accent)",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "20 6 9 17 4 12"
  })) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/** Pill text input matching the waitlist/auth forms. */
function Input({
  style,
  error = false,
  ...props
}) {
  const [focused, setFocused] = useState(false);
  return /*#__PURE__*/React.createElement("input", _extends({
    onFocus: e => {
      setFocused(true);
      props.onFocus?.(e);
    },
    onBlur: e => {
      setFocused(false);
      props.onBlur?.(e);
    },
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-input)',
      lineHeight: 'var(--text-input-lh)',
      color: 'var(--white)',
      background: focused ? 'rgba(255,255,255,.1)' : 'var(--surface-input)',
      border: `1px solid ${error ? 'var(--color-error)' : focused ? 'var(--brand-accent)' : 'var(--border-medium)'}`,
      borderRadius: 'var(--radius-pill)',
      height: 52,
      padding: '0 20px',
      width: '100%',
      boxShadow: focused ? error ? 'var(--shadow-focus-error)' : 'var(--shadow-focus)' : 'none',
      outline: 'none',
      transition: 'all var(--duration-fast) ease',
      boxSizing: 'border-box',
      ...style
    }
  }, props));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/** Pill toggle switch — cyan track when on. */
function Switch({
  checked: checkedProp,
  defaultChecked = false,
  onChange,
  style,
  ...props
}) {
  const isControlled = checkedProp !== undefined;
  const [internal, setInternal] = useState(defaultChecked);
  const checked = isControlled ? checkedProp : internal;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": checked,
    onClick: e => {
      if (!isControlled) setInternal(v => !v);
      onChange?.(!checked, e);
    },
    style: {
      width: 40,
      height: 22,
      borderRadius: 'var(--radius-pill)',
      cursor: 'pointer',
      border: 'none',
      background: checked ? 'var(--brand-accent)' : 'rgba(255,255,255,.18)',
      position: 'relative',
      transition: 'background var(--duration-fast) ease',
      padding: 0,
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 20 : 2,
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: 'var(--white)',
      transition: 'left var(--duration-fast) ease'
    }
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Accordion.jsx
try { (() => {
const {
  useState
} = React;
/** Vertically-stacked expand/collapse list. items: [{title,content}]. */
function Accordion({
  items,
  style
}) {
  const [open, setOpen] = useState(0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...style
    }
  }, items.map((it, i) => {
    const expanded = open === i;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setOpen(expanded ? -1 : i),
      style: {
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '18px 0',
        fontFamily: 'var(--font-body)',
        fontSize: 15,
        fontWeight: 'var(--weight-medium)',
        color: 'var(--text-primary)'
      }
    }, it.title, /*#__PURE__*/React.createElement("span", {
      style: {
        transform: expanded ? 'rotate(180deg)' : 'none',
        transition: 'transform var(--duration-fast) ease',
        color: 'var(--text-muted)'
      }
    }, "\u25BE")), expanded ? /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        paddingBottom: 18,
        fontSize: 14,
        lineHeight: 1.7,
        color: 'var(--text-secondary)'
      }
    }, it.content) : null);
  }));
}
Object.assign(__ds_scope, { Accordion });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Accordion.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
const {
  useState
} = React;
/** Segmented pill tab group. items: [{value,label}]. */
function Tabs({
  items,
  defaultValue,
  onChange,
  style
}) {
  const [active, setActive] = useState(defaultValue ?? items[0]?.value);
  function select(v) {
    setActive(v);
    onChange?.(v);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: 4,
      padding: 4,
      borderRadius: 'var(--radius-pill)',
      background: 'rgba(255,255,255,.05)',
      border: '1px solid var(--border-subtle)',
      ...style
    }
  }, items.map(it => {
    const isActive = it.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      onClick: () => select(it.value),
      style: {
        border: 'none',
        cursor: 'pointer',
        padding: '8px 18px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        fontWeight: 'var(--weight-medium)',
        background: isActive ? 'var(--brand-accent)' : 'transparent',
        color: isActive ? 'var(--text-on-accent)' : 'var(--text-secondary)',
        transition: 'all var(--duration-fast) ease'
      }
    }, it.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Dialog.jsx
try { (() => {
/** Centered modal with dark overlay. */
function Dialog({
  open,
  onClose,
  title,
  children,
  style
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,.6)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      background: 'var(--brand-navy)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      width: 'min(90vw, 440px)',
      boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-body)',
      color: 'var(--text-primary)',
      ...style
    }
  }, title ? /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-heading)',
      fontWeight: 500,
      fontSize: 22
    }
  }, title) : null, children, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      position: 'absolute',
      top: 16,
      right: 16,
      background: 'rgba(255,255,255,.08)',
      border: 'none',
      color: 'var(--white)',
      width: 28,
      height: 28,
      borderRadius: '50%',
      cursor: 'pointer'
    }
  }, "\u2715")));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Dialog.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Kbd = __ds_scope.Kbd;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Progress = __ds_scope.Progress;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Accordion = __ds_scope.Accordion;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Dialog = __ds_scope.Dialog;

})();
