// Blastproof demo shop — tiny client-side store, no dependencies.
// Demo credentials are intentionally hardcoded for local E2E validation.
(function () {
  'use strict';

  var DEMO_EMAIL = 'demo@blastproof.dev';
  var DEMO_PASSWORD = 'demo123';
  var CART_KEY = 'blastproof-demo-cart';

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function setCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }

  function money(value) {
    return '$' + value.toFixed(2);
  }

  // --- home: add to cart -----------------------------------------------------
  document.querySelectorAll('[data-add-to-cart]').forEach(function (button) {
    button.addEventListener('click', function () {
      var cart = getCart();
      cart.push({ name: button.dataset.name, price: Number(button.dataset.price) });
      setCart(cart);
      var feedback = document.getElementById('cart-feedback');
      if (feedback) feedback.textContent = button.dataset.name + ' added to cart.';
    });
  });

  // --- login ------------------------------------------------------------------
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = document.getElementById('email').value.trim();
      var password = document.getElementById('password').value;
      if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
        window.location.href = 'account.html';
      } else {
        document.getElementById('login-error').hidden = false;
      }
    });
  }

  // --- cart -------------------------------------------------------------------
  var cartList = document.getElementById('cart-items');
  if (cartList) {
    var discount = 0;

    function render() {
      var cart = getCart();
      var subtotal = cart.reduce(function (sum, item) {
        return sum + item.price;
      }, 0);

      cartList.innerHTML = '';
      cart.forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item.name + ' — ' + money(item.price);
        cartList.appendChild(li);
      });
      document.getElementById('cart-empty').hidden = cart.length > 0;

      document.getElementById('subtotal').textContent = money(subtotal);
      document.getElementById('discount-row').hidden = discount === 0;
      document.getElementById('discount').textContent = '-' + money(discount);
      document.getElementById('total').textContent = money(Math.max(0, subtotal - discount));
    }

    var promoForm = document.getElementById('promo-form');
    promoForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var code = document.getElementById('promo-code').value.trim().toUpperCase();
      var feedback = document.getElementById('promo-feedback');
      var subtotal = getCart().reduce(function (sum, item) {
        return sum + item.price;
      }, 0);
      if (code === 'SAVE20') {
        discount = subtotal * 0.2;
        feedback.textContent = 'Promo code SAVE20 applied: 20% off.';
      } else {
        discount = 0;
        feedback.textContent = 'Unknown promo code "' + code + '".';
      }
      render();
    });

    render();
  }
})();
