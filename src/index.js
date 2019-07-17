const manager = {
  currentTarget: null,
  getTarget() {
    return this.currentTarget;
  },
  isRendering(elem) {
    return this.currentTarget === elem;
  },

  hookCounter: 0,
  allocHook() {
    if (!this.currentTarget) {
      throw new Error(
        "Hooks can only be used in Hooked(React, FunctionalComponent)s"
      );
    }
    return this.hookCounter++;
  },

  terminate: true,
  invalidateRendering() {
    this.terminate = false;
    // TODO: consider `throw`ing here to abort current render pass
  },
  rerender() {
    const done = this.terminate;
    this.terminate = true;
    return !done;
  },

  setup(elem) {
    this.currentTarget = elem;
    this.hookCounter = 0;
    this.terminate = true;
  },
  teardown(elem) {
    if (this.currentTarget === elem) {
      this.setup(null);
    } else {
      this.setup(null); // TODO: handle/report failed assertion
    }
  }
};

export const Hooked = (React, render) => {
  class Managed extends React.Component {
    componentDidMount() {
      if (!this.effects) {
        return;
      }

      this.effects.forEach(data => {
        data.model.end = data.model.begin();
      });
    }

    componentDidUpdate() {
      if (!this.effects) {
        return;
      }

      this.effects.forEach(data => {
        if (data.model.run) {
          data.model.run = false;

          if (data.model.end) {
            data.model.end();
          }

          data.model.end = data.model.begin();
        }
      });
    }

    componentWillUnmount() {
      if (!this.effects) {
        return;
      }

      this.effects.forEach(data => {
        if (data.model.end) {
          data.model.end();
        }
      });
    }

    render() {
      let node;

      manager.setup(this);

      try {
        do {
          // TODO: maybe try/catch in loop for early rerendering(/suspense?)
          node = render(this.props);
        } while (manager.rerender());
      } catch (err) {
        manager.teardown(this);
        throw err;
      }

      manager.teardown(this);

      return node;
    }
  };

  Managed.propTypes = render.propTypes;
  Managed.defaultProps = render.defaultProps;

  return Managed;
};

const modelState = target => {
  let model = {
    state,
    setState: update => {
      const next = typeof update === "function" ? update(model.state) : update;

      if (model.state === next) {
        return;
      }

      model.state = next;

      if (manager.isRendering(target)) {
        manager.invalidateRendering();
      } else {
        target.forceUpdate();
      }
    }
  };

  return model;
};

export const useState = initial => {
  const key = manager.allocHook();
  const target = manager.getTarget();

  target.states = target.states || new Map();

  const data =
    target.states.get(key) ||
    target.states
      .set(key, {
        key,
        type: "useState",
        model: null
      })
      .get(key);

  if (data.type !== "useState") {
    throw new Error("Hook called out of order");
  }

  if (!data.model) {
    data.model = modelState(target);
    data.model.state = typeof initial === "function" ? initial() : initial;
  }

  return [data.model.state, data.model.setState];
};

export const useRef = initial => {
  const key = manager.allocHook();
  const target = manager.getTarget();

  target.refs = target.refs || new Map();

  const data =
    target.refs.get(key) ||
    target.refs
      .set(key, {
        key,
        type: "useRef",
        model: { ref: { current: initial } }
      })
      .get(key);

  if (data.type !== "useRef") {
    throw new Error("Hook called out of order");
  }

  return data.model.ref;
};

const validateDeps = deps => {
  if (deps === undefined) {
    return undefined;
  } else if (Array.isArray(deps)) {
    return deps;
  } else {
    throw new Error("Dependencies must be an Array or undefined");
  }
};

export const useEffect = (begin, deps) => {
  const key = manager.allocHook();
  const target = manager.getTarget();

  target.effects = target.effects || new Map();

  const data =
    target.effects.get(key) ||
    target.effects
      .set(key, {
        key,
        type: "useEffect",
        model: {
          begin,
          end: null,
          deps: validateDeps(deps),
          run: false
        }
      })
      .get(key);

  if (data.type !== "useEffect") {
    throw new Error("Hook called out of order");
  }

  const from = data.model.deps;
  const to = validateDeps(deps);

  if (from && to && from.length == to.length) {
    let idx = from.length;
    while (idx-- > 0 && from[idx] === to[idx]) {}

    if (idx < 0) {
      return;
    }
  }

  data.model.run = true;
  data.model.begin = begin;
};
