Dashboards are the bread and butter of spatial data displays. They are highly interactive websites, usually with real-time updates that show data in an accessible way.


## Timeline

We will allocate weeks 5-8 (four weeks) of the semester to this project.


## Samples

Find examples from previous years at <https://github.com/Weitzman-MUSA-JavaScript/dashboard-project-examples>.


## Instructions

### Step 1: Choose a topic

- [ ] **Choose a topic** that is fruitfully explained with some combination of narrative and geographic elements. This might be as general as public transit, bike share, real estate development, national parks, etc. Stick with the data domain that you chose for your story map if you can.

- [ ] **Choose your users** -- Who do you want to empower with information to make decisions in your domain. For example, if you chose public transit, then are you interested in empowering riders? Dispatchers? If you chose national parks, are you interested in visitors? Park rangers? Try not to build one thing for _everyone_ -- that usually leads to a product that is not very useful for anyone.

- [ ] **Decide what your users could do with better information** -- Make a list of the particular decisions you want to enable with your dashboard. This can be a blue-sky list, but you will likely end up refining your scope later.

- [ ] **Figure out what data you need to enable the decisions.** -- You should use this list of decisions you want to enable to evaluate any dataset or interactive element you add to your dashboard, to determine whether it actually supports making those decisions. Whatever data you use, **be sure to include citations somewhere in your app interface**.

### Step 2: Create a map on your browser

The main component of the dashboard is the map displaying spatial information. This is the building block of all your other features!

* Create basic html with head and body elements, linking to your css stylesheet and javascript file
* Create map element in html document
* Style map element in CSS to give it height
* Create map object in Javascript referencing leaflet quickstart https://leafletjs.com/examples/quick-start/ (will need to link to leaflet documents in your html)
* Add a basemap tile layer - use OpenStreetMap, Stamen, Mapbox, or another source - you can customize this!
* NOTE: you may want to separate the code for creating the map into a different javascript file for organization. If you do this, wrap the creation of the map into a function and export that function, and then import it in your main.js file.

### Step 3: Add data to your map

* Add data file to your repository folder (usually in a data subfolder) - remember geojson files work best, csv files work too but must be parsed using csv parse https://csv.js.org/parse/ or papa parse https://www.papaparse.com/ . See [the course resources](https://github.com/musa-6110-fall-2023/course-info/blob/main/resources/data-format-csv.md) for a guide to getting started with those libraries.
* Use fetch API https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API to load your data into your environment (remember, fetch returns a promise, not a file, and a file needs to be extracted from the promise)
* Create map layer to display data (ie LayerGroup, Marker, etc.. see documentation https://leafletjs.com/reference.html) - style the layer here, not in CSS because CSS cannot access styles within the map 
* Display data through your map layer (either create an empty layer and pass the data through in a separate function, or input the data directly when you create the layer)
* optional: attach popup https://leafletjs.com/reference.html#popup and tooltip https://leafletjs.com/reference.html#tooltip to your data layer for more interactivity

### Step 4: Create an interactive element (ie search, highlight, print data, etc)

This is the most broad step because you could do so many different things like: 
* button to filter data shown on map
* checkbox to filter data shown on map
* search bar to type in to filter data shown on map (more difficult - try only if you've already accomplished the button)
* paste/display text of data attributes when you click on the data layer on the map
* graph data shown on map

The general steps to accomplish these are:
* create an html element for the interactive piece (ie button, checkbox, searchbar, graph) ps. if you're interactive event will be clicking on the map, no extra element is needed
* create a DOM (document object model) element in javascript to set up an event listener - reference DOM exercise we did in class https://github.com/musa-6110-fall-2023/dom-exercises
* create an event listener (event examples: click a button, check a checkbox, click a map data layer)
* create a function which responds when the event has happened
* create a function to parse through data (will require for loop) and accomplish one of the following:
    * clear data layer and display only the filtered data
    * print in space outside map (new html element) information about the data
    * pass data shown on map through a graph and display
 
### Step 5: Finishing touches (styling, linting, accessibility)

* style the map and data to your liking, which can include doing things like:
   * customizing your basemap tiles
   * customizing your marker/data layer style (using your own image in replace for the marker image)
   * changing fonts and colors in the csv

Make sure to lint use eslint or stylelint to ensure your code is using the widely acceptable syntax

Check for accessibility using:
* Axe DevTools in browser
* accessible colors for someone looking at your map, reference colorbrewer or other sites for help with this 


  
