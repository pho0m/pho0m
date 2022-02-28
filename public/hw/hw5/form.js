(function () {
  var forms = document.querySelectorAll(".needs-validation");

  Array.prototype.slice.call(forms).forEach(function (form) {
    form.addEventListener(
      "submit",
      function (event) {
        if (!form.checkValidity()) {
          event.preventDefault();
          event.stopPropagation();
        }
        form.classList.add("was-validated");

        var kvpairs = [];
        for (var i = 0; i < form.elements.length; i++) {
          var e = form.elements[i];
          kvpairs.push(
            encodeURIComponent(e.name) + "=" + encodeURIComponent(e.value)
          );
        }
        console.log(kvpairs);

        let allAreFilled = true;
        document
          .getElementById("myForm")
          .querySelectorAll("[required]")
          .forEach(function (i) {
            if (!allAreFilled) return;
            if (!i.value) allAreFilled = false;
            if (i.type === "radio") {
              let radioValueCheck = false;
              document
                .getElementById("myForm")
                .querySelectorAll(`[name=${i.name}]`)
                .forEach(function (r) {
                  if (r.checked) radioValueCheck = true;
                });
              allAreFilled = radioValueCheck;
            }
          });
        if (!allAreFilled) {
          Swal.fire({
            icon: "error",
            title: "Oops...",
            text: "Something went wrong, Please fill all the required fields",
          });
        } else {
          Swal.fire({
            icon: "success",
            title: "Your work has been saved",
            showConfirmButton: false,
            timer: 2500,
          });
        }
      },
      false
    );
  });
})();
